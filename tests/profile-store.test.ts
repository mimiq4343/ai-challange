import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";

import { SqliteConversationStore } from "../src/lib/conversation-store";
import { SqliteMemoryStore } from "../src/lib/memory-store";
import { LastProfileError, SqliteProfileStore } from "../src/lib/profile-store";

const temporaryDirectories: string[] = [];

after(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createDatabasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "flash-profile-"));
  temporaryDirectories.push(directory);
  return join(directory, "chat.sqlite");
}

test("schema creates exactly one active profile", async () => {
  const profiles = new SqliteProfileStore(await createDatabasePath());

  const list = profiles.listProfiles();
  assert.equal(list.length, 1);
  assert.equal(list[0].active, true);
  assert.equal(profiles.getActiveProfile().id, list[0].id);

  profiles.close();
});

test("activating a profile deactivates the previous one", async () => {
  const profiles = new SqliteProfileStore(await createDatabasePath());
  const engineer = profiles.createProfile({
    name: "Инженер",
    verbosity: "brief",
    format: "code_first",
    expertise: "expert",
  });

  assert.equal(engineer.active, false);
  const activated = profiles.activateProfile(engineer.id);
  assert.equal(activated.active, true);
  assert.equal(profiles.getActiveProfile().id, engineer.id);
  assert.equal(profiles.listProfiles().filter((profile) => profile.active).length, 1);

  profiles.close();
});

test("long term memory is isolated per profile", async () => {
  const databasePath = await createDatabasePath();
  const conversations = new SqliteConversationStore(databasePath);
  const memory = new SqliteMemoryStore(databasePath);
  const profiles = new SqliteProfileStore(databasePath);

  const first = profiles.getActiveProfile();
  const second = profiles.createProfile({ name: "Новичок" });
  memory.upsertLongTerm({
    profileId: first.id,
    kind: "profile",
    key: "language",
    value: "TypeScript",
    origin: "user",
    reason: null,
    sourceConversationId: null,
  });
  memory.upsertLongTerm({
    profileId: second.id,
    kind: "profile",
    key: "language",
    value: "Python",
    origin: "user",
    reason: null,
    sourceConversationId: null,
  });

  assert.deepEqual(
    memory.listLongTerm(first.id).map((entry) => entry.value),
    ["TypeScript"],
  );
  assert.deepEqual(
    memory.listLongTerm(second.id).map((entry) => entry.value),
    ["Python"],
  );

  memory.close();
  profiles.close();
  conversations.close();
});

test("deleting a profile removes its memory and activates another one", async () => {
  const databasePath = await createDatabasePath();
  const memory = new SqliteMemoryStore(databasePath);
  const profiles = new SqliteProfileStore(databasePath);

  const base = profiles.getActiveProfile();
  const temporary = profiles.activateProfile(
    profiles.createProfile({ name: "Временный" }).id,
  );
  memory.upsertLongTerm({
    profileId: temporary.id,
    kind: "knowledge",
    key: "fact",
    value: "значение",
    origin: "user",
    reason: null,
    sourceConversationId: null,
  });
  profiles.addConstraint(temporary.id, "без эмодзи", "user", null);

  const nowActive = profiles.deleteProfile(temporary.id);
  assert.equal(nowActive.id, base.id);
  assert.equal(profiles.listProfiles().length, 1);
  assert.equal(memory.listLongTerm(temporary.id).length, 0);

  assert.throws(() => profiles.deleteProfile(base.id), LastProfileError);

  memory.close();
  profiles.close();
});

test("router writes update preferences and add constraints once", async () => {
  const databasePath = await createDatabasePath();
  const conversations = new SqliteConversationStore(databasePath);
  const profiles = new SqliteProfileStore(databasePath);
  const conversation = conversations.createConversation();
  const profile = profiles.getActiveProfile();

  const applied = profiles.applyProfileWrites(
    profile.id,
    [
      { layer: "profile", kind: "verbosity", value: "brief", reason: "просил короче" },
      { layer: "profile", kind: "format", value: "code_first", reason: null },
      { layer: "profile", kind: "constraint", value: "без эмодзи", reason: null },
      { layer: "profile", kind: "constraint", value: "без эмодзи", reason: null },
    ],
    { conversationId: conversation.id, assistantMessageId: null },
  );

  assert.equal(applied, 3);
  const updated = profiles.getActiveProfile();
  assert.equal(updated.verbosity, "brief");
  assert.equal(updated.format, "code_first");
  assert.deepEqual(
    updated.constraints.map((constraint) => constraint.value),
    ["без эмодзи"],
  );

  profiles.close();
  conversations.close();
});

test("day 11 long term memory migrates into the default profile", async () => {
  const databasePath = await createDatabasePath();
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE memory_long_term (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK (kind IN ('profile', 'decision', 'knowledge')),
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      origin TEXT NOT NULL CHECK (origin IN ('router', 'user')),
      reason TEXT,
      source_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (kind, key)
    ) STRICT;

    CREATE TABLE memory_writes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
      assistant_message_id INTEGER,
      layer TEXT NOT NULL CHECK (layer IN ('working', 'long_term')),
      kind TEXT NOT NULL,
      key TEXT,
      value TEXT NOT NULL,
      reason TEXT,
      origin TEXT NOT NULL CHECK (origin IN ('router', 'user')),
      created_at TEXT NOT NULL
    ) STRICT;

    INSERT INTO memory_long_term (
      kind, key, value, origin, reason, source_conversation_id, created_at, updated_at
    ) VALUES ('profile', 'user_name', 'Роман', 'router', 'из Day 11', NULL,
              '2026-09-20T10:00:00.000Z', '2026-09-20T10:00:00.000Z');

    INSERT INTO memory_writes (
      conversation_id, assistant_message_id, layer, kind, key, value, reason, origin,
      created_at
    ) VALUES (NULL, NULL, 'long_term', 'profile', 'user_name', 'Роман', 'из Day 11',
              'router', '2026-09-20T10:00:00.000Z');
  `);
  legacy.close();

  const profiles = new SqliteProfileStore(databasePath);
  const memory = new SqliteMemoryStore(databasePath);
  const active = profiles.getActiveProfile();

  const entries = memory.listLongTerm(active.id);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, "user_name");
  assert.equal(entries[0].profileId, active.id);

  const migratedProfileWrite = profiles.applyProfileWrites(
    active.id,
    [{ layer: "profile", kind: "tone", value: "direct", reason: null }],
    { conversationId: null, assistantMessageId: null },
  );
  assert.equal(migratedProfileWrite, 1);
  assert.equal(profiles.getActiveProfile().tone, "direct");

  memory.close();
  profiles.close();
});

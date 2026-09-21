import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { SqliteConversationStore } from "../src/lib/conversation-store";
import { SqliteMemoryStore } from "../src/lib/memory-store";
import { SqliteProfileStore } from "../src/lib/profile-store";

const temporaryDirectories: string[] = [];

after(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createStores() {
  const directory = await mkdtemp(join(tmpdir(), "flash-memory-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "chat.sqlite");
  const conversations = new SqliteConversationStore(databasePath);
  const memory = new SqliteMemoryStore(databasePath);
  const profiles = new SqliteProfileStore(databasePath);
  return {
    conversations,
    memory,
    profiles,
    profileId: profiles.getActiveProfile().id,
    databasePath,
  };
}

test("long term memory keeps one entry per kind and key", async () => {
  const { conversations, memory, profiles, profileId } = await createStores();
  const conversation = conversations.createConversation();

  memory.upsertLongTerm({
    profileId,
    kind: "profile",
    key: "favourite_color",
    value: "синий",
    origin: "router",
    reason: "пользователь назвал цвет",
    sourceConversationId: conversation.id,
  });
  const updated = memory.upsertLongTerm({
    profileId,
    kind: "profile",
    key: "favourite_color",
    value: "зелёный",
    origin: "user",
    reason: null,
    sourceConversationId: conversation.id,
  });

  const entries = memory.listLongTerm(profileId);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, updated.id);
  assert.equal(entries[0].value, "зелёный");
  assert.equal(entries[0].origin, "user");

  memory.close();
  profiles.close();
  conversations.close();
});

test("deleting a conversation clears working memory but keeps long term entries", async () => {
  const { conversations, memory, profiles, profileId } = await createStores();
  const conversation = conversations.createConversation();
  const task = memory.upsertActiveTask(conversation.id, {
    title: "Миграция",
    goal: "Перенести хранилище",
  });
  memory.addSlot(
    task.id,
    { kind: "constraint", value: "без сторонних зависимостей", origin: "router", reason: null },
    { conversationId: conversation.id, assistantMessageId: null },
  );
  memory.upsertLongTerm({
    profileId,
    kind: "decision",
    key: "storage",
    value: "SQLite остаётся источником истины",
    origin: "router",
    reason: null,
    sourceConversationId: conversation.id,
  });

  assert.equal(memory.getWorkingMemory(conversation.id)?.slots.length, 1);
  assert.equal(memory.listWrites(conversation.id).length, 1);

  assert.equal(conversations.deleteConversation(conversation.id), true);

  assert.equal(memory.getWorkingMemory(conversation.id), null);
  assert.equal(memory.listWrites(conversation.id).length, 0);
  const longTerm = memory.listLongTerm(profileId);
  assert.equal(longTerm.length, 1);
  assert.equal(longTerm[0].sourceConversationId, null);

  memory.close();
  profiles.close();
  conversations.close();
});

test("a conversation has at most one active task", async () => {
  const { conversations, memory, profiles, profileId } = await createStores();
  const conversation = conversations.createConversation();

  const first = memory.upsertActiveTask(conversation.id, { title: "Первая", goal: null });
  const renamed = memory.upsertActiveTask(conversation.id, {
    title: "Первая уточнённая",
    goal: "Собрать требования",
  });
  assert.equal(renamed.id, first.id);
  assert.equal(memory.getActiveTask(conversation.id)?.title, "Первая уточнённая");

  const closed = memory.closeActiveTask(conversation.id);
  assert.equal(closed?.status, "closed");
  assert.equal(memory.getActiveTask(conversation.id), null);

  const second = memory.upsertActiveTask(conversation.id, { title: "Вторая", goal: null });
  assert.notEqual(second.id, first.id);

  memory.close();
  profiles.close();
  conversations.close();
});

test("router result writes both layers once and journals every write", async () => {
  const { conversations, memory, profiles, profileId } = await createStores();
  const conversation = conversations.createConversation();
  conversations.saveExchange(conversation.id, "Запомни: я пишу на TypeScript", "Запомнил");
  const assistantMessageId = conversations.getMessages(conversation.id).at(-1)!.id;

  const applied = memory.applyRouterResult(conversation.id, assistantMessageId, profileId, {
    task: { title: "Настройка агента", goal: "Собрать модель памяти" },
    closeTask: false,
    writes: [
      {
        layer: "long_term",
        kind: "profile",
        key: "language",
        value: "TypeScript",
        reason: "пользователь назвал основной язык",
      },
      { layer: "working", kind: "step", value: "Описать слои", reason: null },
      { layer: "working", kind: "step", value: "Описать слои", reason: null },
    ],
    cost: null,
    taskState: null,
  });

  assert.equal(applied, 2);
  assert.equal(memory.getWorkingMemory(conversation.id)?.slots.length, 1);
  assert.equal(memory.listLongTerm(profileId)[0].key, "language");

  const writes = memory.listWrites(conversation.id);
  assert.equal(writes.length, 2);
  assert.deepEqual(
    writes.map((write) => write.layer).sort(),
    ["long_term", "working"],
  );
  assert.equal(
    writes.every((write) => write.assistantMessageId === assistantMessageId),
    true,
  );

  memory.close();
  profiles.close();
  conversations.close();
});

test("exchange memory usage round trips layer tokens and router cost", async () => {
  const { conversations, memory, profiles, profileId } = await createStores();
  const conversation = conversations.createConversation();
  conversations.saveExchange(conversation.id, "Вопрос", "Ответ");
  const assistantMessageId = conversations.getMessages(conversation.id).at(-1)!.id;

  memory.saveExchangeMemoryUsage(conversation.id, assistantMessageId, {
    systemTokens: 40,
    profileTokens: 0,
    taskTokens: 0,
    longTermTokens: 120,
    workingTokens: 0,
    shortTermTokens: 300,
    requestTokens: 12,
    promptTokens: 472,
    reservedOutputTokens: 4_096,
    contextTokens: 4_568,
    contextLimit: 1_000_000,
    shortTermMessages: 6,
    layers: {
      shortTerm: true,
      working: false,
      longTerm: true,
      profile: false,
      task: false,
    },
    router: { promptTokens: 220, completionTokens: 40, costMicrosUsd: 114 },
  });

  const usage = memory.getLatestUsage(conversation.id);
  assert.equal(usage?.longTermTokens, 120);
  assert.equal(usage?.workingTokens, 0);
  assert.equal(usage?.shortTermMessages, 6);
  assert.deepEqual(usage?.layers, {
    shortTerm: true,
    working: false,
    longTerm: true,
    profile: false,
    task: false,
  });
  assert.equal(usage?.router?.costMicrosUsd, 114);
  assert.equal(usage?.contextTokens, 4_568);

  memory.close();
  profiles.close();
  conversations.close();
});

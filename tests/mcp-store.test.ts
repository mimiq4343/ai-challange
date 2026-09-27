import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";

import { SqliteInvariantStore } from "../src/lib/invariant-store";
import {
  DuplicateMcpServerError,
  McpServerValidationError,
  SqliteMcpServerStore,
} from "../src/lib/mcp-store";
import { McpValidationError } from "../src/lib/mcp-network";
import { SqliteProfileStore } from "../src/lib/profile-store";

async function createStores(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "flash-mcp-"));
  const databasePath = join(directory, "chat.sqlite");
  const stores: Array<{ close(): void }> = [];
  t.after(async () => {
    for (const store of stores.reverse()) store.close();
    await rm(directory, { recursive: true, force: true });
  });
  // MCP-хранилище первым открывает новую базу, без предварительной миграции.
  const servers = new SqliteMcpServerStore(databasePath);
  stores.push(servers);
  const profiles = new SqliteProfileStore(databasePath);
  stores.push(profiles);
  return {
    databasePath,
    profiles,
    servers,
    profileId: profiles.getActiveProfile().id,
    track<T extends { close(): void }>(store: T): T {
      stores.push(store);
      return store;
    },
    closeAll() {
      for (const store of stores.splice(0).reverse()) store.close();
    },
  };
}

test("MCP configs survive closing every store and reopening a fresh database", async (t) => {
  const fixture = await createStores(t);
  const saved = fixture.servers.create(fixture.profileId, {
    name: "  Документация  ",
    url: "https://EXAMPLE.COM:443/a/../mcp",
  });
  assert.equal(saved.name, "Документация");
  assert.equal(saved.url, "https://example.com/mcp");
  assert.equal(saved.profileId, fixture.profileId);
  assert.ok(Number.isFinite(Date.parse(saved.createdAt)));
  fixture.closeAll();

  const reopened = fixture.track(new SqliteMcpServerStore(fixture.databasePath));
  assert.deepEqual(reopened.listServers(fixture.profileId), [saved]);
  assert.deepEqual(reopened.getServer(fixture.profileId, saved.id), saved);
});

test("MCP list, lookup and deletion stay inside the selected profile", async (t) => {
  const { servers, profiles, profileId } = await createStores(t);
  const second = profiles.createProfile({ name: "Второй" });
  const firstServer = servers.create(profileId, {
    name: "Первый",
    url: "https://example.com/mcp",
  });
  const secondServer = servers.create(second.id, {
    name: "Второй",
    url: "https://example.com/mcp",
  });

  assert.deepEqual(servers.listServers(profileId), [firstServer]);
  assert.deepEqual(servers.listServers(second.id), [secondServer]);
  assert.equal(servers.getServer(profileId, secondServer.id), null);
  assert.equal(servers.getServer(second.id, firstServer.id), null);
  assert.equal(servers.delete(profileId, secondServer.id), false);
  assert.equal(servers.delete(second.id, firstServer.id), false);
  assert.deepEqual(servers.getServer(second.id, secondServer.id), secondServer);
  assert.deepEqual(servers.getServer(profileId, firstServer.id), firstServer);
});

test("normalized duplicate URLs cannot overwrite a saved MCP config", async (t) => {
  const { databasePath, servers, profileId, track } = await createStores(t);
  const saved = servers.create(profileId, {
    name: "Оригинал",
    url: "https://example.com/mcp",
  });
  assert.throws(
    () => servers.create(profileId, {
      name: "Дубликат",
      url: "https://EXAMPLE.COM:443/a/../mcp",
    }),
    DuplicateMcpServerError,
  );
  assert.deepEqual(servers.listServers(profileId), [saved]);

  const database = track(new DatabaseSync(databasePath));
  assert.throws(
    () => database.prepare(`
      INSERT INTO mcp_servers (profile_id, name, url, created_at)
      VALUES (?, ?, ?, ?)
    `).run(profileId, "Обход проверки", saved.url, saved.createdAt),
    { code: "ERR_SQLITE_ERROR", errcode: 2067 },
  );
  assert.deepEqual(servers.getServer(profileId, saved.id), saved);
});

test("MCP deletion persists and permits adding the URL again", async (t) => {
  const fixture = await createStores(t);
  const saved = fixture.servers.create(fixture.profileId, {
    name: "Удаляемый",
    url: "https://example.com/mcp",
  });
  assert.equal(fixture.servers.delete(fixture.profileId, saved.id), true);
  assert.equal(fixture.servers.delete(fixture.profileId, saved.id), false);
  assert.equal(fixture.servers.getServer(fixture.profileId, saved.id), null);
  fixture.closeAll();

  const reopened = fixture.track(new SqliteMcpServerStore(fixture.databasePath));
  assert.deepEqual(reopened.listServers(fixture.profileId), []);
  const replacement = reopened.create(fixture.profileId, {
    name: "Новый",
    url: "https://example.com/mcp",
  });
  assert.notEqual(replacement.id, saved.id);
  assert.deepEqual(reopened.listServers(fixture.profileId), [replacement]);
});

test("deleting a profile cascades MCP configs without deleting another profile's configs", async (t) => {
  const { servers, profiles, profileId } = await createStores(t);
  const second = profiles.createProfile({ name: "Удаляемый профиль" });
  const retained = servers.create(profileId, {
    name: "Основной",
    url: "https://example.com/mcp",
  });
  const removed = servers.create(second.id, {
    name: "Второй",
    url: "https://example.org/mcp",
  });
  profiles.deleteProfile(second.id);

  assert.deepEqual(servers.listServers(second.id), []);
  assert.equal(servers.getServer(second.id, removed.id), null);
  assert.deepEqual(servers.listServers(profileId), [retained]);
  assert.throws(
    () => servers.create(second.id, {
      name: "Несуществующий профиль",
      url: "https://example.org/mcp",
    }),
    { code: "ERR_SQLITE_ERROR", errcode: 787 },
  );
});

test("MCP initialization leaves existing Day 15 invariants intact", async (t) => {
  const fixture = await createStores(t);
  const invariants = fixture.track(new SqliteInvariantStore(fixture.databasePath));
  const invariant = invariants.create(fixture.profileId, {
    category: "stack",
    statement: "Только PostgreSQL",
    rationale: null,
  }, "user");
  fixture.closeAll();

  const servers = fixture.track(new SqliteMcpServerStore(fixture.databasePath));
  servers.create(fixture.profileId, { name: "MCP", url: "https://example.com/mcp" });
  const reopened = fixture.track(new SqliteInvariantStore(fixture.databasePath));
  assert.deepEqual(reopened.listActive(fixture.profileId), [invariant]);
  assert.equal(reopened.listEvents(fixture.profileId)[0].kind, "created");
});

test("invalid MCP names and credential-bearing URLs never become saved configs", async (t) => {
  const { servers, profileId } = await createStores(t);
  for (const name of ["", "   ", "x".repeat(121)]) {
    assert.throws(
      () => servers.create(profileId, { name, url: "https://example.com/mcp" }),
      McpServerValidationError,
    );
  }
  assert.throws(
    () => servers.create(profileId, {
      name: "Секрет",
      url: "https://user:password@example.com/mcp",
    }),
    McpValidationError,
  );
  assert.deepEqual(servers.listServers(profileId), []);
});

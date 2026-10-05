import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { SqliteConversationStore } from "../src/lib/conversation-store";
import { ORCHESTRATION_LIMITS } from "../src/lib/orchestration-config";
import { SqliteOrchestrationStore } from "../src/lib/orchestration-run-store";
import { SqliteProfileStore } from "../src/lib/profile-store";

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "flash-orchestration-"));
  const path = join(directory, "chat.sqlite");
  const profiles = new SqliteProfileStore(path);
  const conversations = new SqliteConversationStore(path);
  const store = new SqliteOrchestrationStore(path);
  t.after(async () => { store.close(); conversations.close(); profiles.close(); await rm(directory, { recursive: true, force: true }); });
  return { store, conversations, profileId: profiles.getActiveProfile().id, conversationId: conversations.createConversation().id };
}

test("journal keeps the routed order, per-step outcome and server availability of the latest run", async (t) => {
  const f = await fixture(t);
  const runId = f.store.startRun(f.profileId, f.conversationId, "Найди, проверь и сохрани");
  f.store.setServers(runId, [
    { id: "pipeline", name: "Flash Pipeline", status: "available", tools: ["search_repositories"] },
    { id: "deepwiki", name: "DeepWiki", status: "unavailable", error: "Истекло время ожидания MCP-сервера." },
  ]);
  f.store.startCall(runId, "call-a", "pipeline", "search_repositories", { query: "sqlite" });
  f.store.startCall(runId, "call-b", "flash", "get_repository_info", { owner: "a", repo: "b" });
  f.store.finishCall(runId, "call-b", true);
  f.store.finishCall(runId, "call-a", false);
  f.store.finishRun(runId, { status: "completed" });

  const run = f.store.latestRun(f.profileId)!;
  assert.equal(run.status, "completed");
  assert.deepEqual(run.calls.map(({ step, serverId, tool, status }) => ({ step, serverId, tool, status })), [
    { step: 1, serverId: "pipeline", tool: "search_repositories", status: "ok" },
    { step: 2, serverId: "flash", tool: "get_repository_info", status: "error" },
  ]);
  assert.deepEqual(run.calls[0].arguments, { query: "sqlite" });
  assert.equal(run.servers?.[1].status, "unavailable");
  // Итог завершённого запуска не переписывается поздним событием.
  f.store.finishRun(runId, { status: "failed", error: "late" });
  assert.equal(f.store.latestRun(f.profileId)!.status, "completed");
});

test("a call routed to an unregistered server is rejected", async (t) => {
  const f = await fixture(t);
  const runId = f.store.startRun(f.profileId, f.conversationId, "x");
  assert.throws(() => f.store.startCall(runId, "call", "stranger", "tool", {}));
  assert.deepEqual(f.store.latestRun(f.profileId)!.calls, []);
});

test("a run that outlived the agent deadline is reported as interrupted", async (t) => {
  const f = await fixture(t);
  f.store.startRun(f.profileId, f.conversationId, "x");
  const created = Date.parse(f.store.latestRun(f.profileId)!.createdAt);
  assert.equal(f.store.latestRun(f.profileId, created + ORCHESTRATION_LIMITS.timeoutMs)!.status, "running");
  assert.equal(f.store.latestRun(f.profileId, created + ORCHESTRATION_LIMITS.timeoutMs + 61_000)!.status, "interrupted");
});

test("retention keeps only the newest runs and deleting the conversation removes its journal", async (t) => {
  const f = await fixture(t);
  const ids = Array.from({ length: ORCHESTRATION_LIMITS.runRetention + 2 }, (_, index) => f.store.startRun(f.profileId, f.conversationId, `run ${index}`));
  f.store.startCall(ids.at(-1)!, "call", "flash", "get_repository_info", { owner: "a", repo: "b" });
  assert.equal(f.store.latestRun(f.profileId)!.runId, ids.at(-1));
  assert.throws(() => f.store.startCall(ids[0], "old", "flash", "get_repository_info", {}), /FOREIGN KEY/);
  assert.equal(f.conversations.deleteConversation(f.conversationId), true);
  assert.equal(f.store.latestRun(f.profileId), null);
});

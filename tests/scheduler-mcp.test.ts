import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { SqliteProfileStore } from "../src/lib/profile-store";
import { SqliteSchedulerStore } from "../src/lib/scheduler-store";
import { createSchedulerMcpServer } from "../src/lib/scheduler-mcp-server";
import { createDemoMcpServer } from "../src/lib/mcp-demo-server";
import { withMcpTools } from "../src/lib/mcp-client";
import { MCP_PUBLIC_URL } from "../src/lib/mcp-config";
import { SCHEDULER_MCP_URL } from "../src/lib/scheduler-config";

async function connect(t: TestContext, server: McpServer) {
  const client = new Client({ name: "scheduler-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}

test("MCP schedule mutation is durable, idempotent and restricted to authenticated profile", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "flash-scheduler-mcp-"));
  const path = join(directory, "chat.sqlite");
  const profiles = new SqliteProfileStore(path);
  const store = new SqliteSchedulerStore(path);
  t.after(async () => { store.close(); profiles.close(); await rm(directory, { recursive: true, force: true }); });
  const profile = profiles.getActiveProfile();
  const second = profiles.createProfile({ name: "Другой профиль" });
  const client = await connect(t, createSchedulerMcpServer(profile.id, store));
  const input = { owner: "octocat", repo: "Hello-World", intervalMinutes: 60 };
  const created = CallToolResultSchema.parse(await client.callTool({ name: "create_repository_schedule", arguments: input }));
  assert.notEqual(created.isError, true);
  const saved = store.list(profile.id)[0];
  assert.equal(saved.status, "active");
  assert.equal((created.structuredContent?.job as Record<string, unknown>).id, saved.id);
  assert.equal("profileId" in (created.structuredContent?.job as Record<string, unknown>), false);
  await client.callTool({ name: "create_repository_schedule", arguments: input });
  assert.deepEqual(store.list(profile.id), [saved]);
  const foreign = store.create(second.id, { ...input, repo: "private-to-profile" });
  const denied = await client.callTool({ name: "stop_repository_schedule", arguments: { jobId: foreign.id } });
  assert.equal(denied.isError, true);
  assert.equal(store.list(second.id)[0].status, "active");
  const injected = await client.callTool({ name: "create_repository_schedule", arguments: { ...input, profileId: second.id } });
  assert.equal(injected.isError, true);
  const summary = CallToolResultSchema.parse(await client.callTool({ name: "get_repository_summary", arguments: { jobId: saved.id } }));
  assert.equal(summary.structuredContent?.sampleCount, 0);
  assert.equal(summary.structuredContent?.starsChange, null);
  await client.callTool({ name: "stop_repository_schedule", arguments: { jobId: saved.id } });
  assert.equal(store.list(profile.id)[0].status, "stopped");
  assert.equal(store.claimDue()?.job.id, foreign.id);
});

test("public MCP cannot discover or invoke persistent schedule tools", async (t) => {
  const client = await connect(t, createDemoMcpServer());
  const discovery = await client.listTools();
  assert.equal(discovery.tools.some(({ name }) => name.includes("schedule")), false);
  const denied = await client.callTool({ name: "create_repository_schedule", arguments: { owner: "octocat", repo: "Hello-World", intervalMinutes: 60 } });
  assert.equal(denied.isError, true);
});

test("scheduler transport refuses credential forwarding outside the exact private endpoint", async (t) => {
  let requested = false;
  t.mock.method(globalThis, "fetch", async () => { requested = true; throw new Error("network must not be reached"); });
  const authorization = { token: "scheduler-test-secret-with-more-than-32-characters", profileId: 1 };
  for (const endpoint of [MCP_PUBLIC_URL, "https://example.com/mcp/scheduler", `${SCHEDULER_MCP_URL}/`]) {
    await assert.rejects(withMcpTools(endpoint, new AbortController().signal, async () => undefined, authorization));
  }
  assert.equal(requested, false);
});

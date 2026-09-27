import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { SqliteProfileStore } from "../src/lib/profile-store";
import { SqlitePipelineStore } from "../src/lib/pipeline-store";
import { createPipelineMcpServer } from "../src/lib/pipeline-mcp-server";
import { createPipelineSummarizer } from "../src/lib/pipeline-summary";

const markdown = "# Результаты\n\nПубличные репозитории не найдены.\n";

async function fixture(t: TestContext, finishReason: string | null = "stop") {
  const directory = await mkdtemp(join(tmpdir(), "flash-pipeline-mcp-"));
  const path = join(directory, "chat.sqlite");
  const profiles = new SqliteProfileStore(path);
  const store = new SqlitePipelineStore(path, join(directory, "reports"));
  const profileId = profiles.getActiveProfile().id;
  // Подменяется только удалённый HTTP, а не ChatAgent, MCP или SQLite.
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    if (String(input).startsWith("https://api.github.com/")) {
      return Response.json({ total_count: 0, incomplete_results: false, items: [] });
    }
    const events = [
      { choices: [{ delta: { content: markdown }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: finishReason }] },
    ];
    return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n");
  });
  const summarize = createPipelineSummarizer({
    NODE_ENV: "test",
    OPENAI_BASE_URL: "https://api.deepseek.com", OPENAI_API_KEY: "test-key", OPENAI_MODEL: "deepseek-v4-flash",
  });
  const server = createPipelineMcpServer(profileId, store, { summarize });
  const client = new Client({ name: "pipeline-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close(); await server.close(); store.close(); profiles.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { client, store, profiles, profileId };
}

test("real MCP chain persists search, complete DeepSeek summary and downloadable exact file", async (t) => {
  const { client, store, profileId } = await fixture(t);
  const found = CallToolResultSchema.parse(await client.callTool({ name: "search_repositories", arguments: { query: "nothing" } }));
  assert.notEqual(found.isError, true);
  assert.deepEqual(found.structuredContent?.repositories, []);
  const summarized = CallToolResultSchema.parse(await client.callTool({ name: "summarize_repositories", arguments: { searchResultId: found.structuredContent!.searchResultId } }));
  assert.notEqual(summarized.isError, true);
  assert.equal(summarized.structuredContent?.markdown, markdown);
  const arguments_ = { summaryId: summarized.structuredContent!.summaryId };
  const saved = CallToolResultSchema.parse(await client.callTool({ name: "save_to_file", arguments: arguments_ }));
  assert.notEqual(saved.isError, true);
  assert.equal(saved.structuredContent?.searchResultId, found.structuredContent!.searchResultId);
  const download = store.getReportDownload(profileId, String(saved.structuredContent!.reportId))!;
  assert.deepEqual(download.bytes, Buffer.from(markdown));
  const repeated = await client.callTool({ name: "save_to_file", arguments: arguments_ });
  assert.deepEqual(repeated.structuredContent, saved.structuredContent);
});

test("MCP rejects foreign IDs and injected ownership, text and file paths", async (t) => {
  const { client, store, profiles } = await fixture(t);
  const other = profiles.createProfile({ name: "Другой" });
  const search = store.saveSearch(other.id, "test", []);
  const summary = store.saveSummary(other.id, search.searchResultId, markdown);
  for (const request of [
    { name: "summarize_repositories", arguments: { searchResultId: search.searchResultId } },
    { name: "summarize_repositories", arguments: { searchResultId: randomUUID() } },
    { name: "save_to_file", arguments: { summaryId: summary.summaryId } },
    { name: "save_to_file", arguments: { summaryId: randomUUID() } },
    { name: "save_to_file", arguments: { summaryId: summary.summaryId, path: "../../bad.md", markdown: "injected" } },
    { name: "search_repositories", arguments: { query: "test", profileId: other.id } },
  ]) {
    const denied = await client.callTool(request);
    assert.equal(denied.isError, true);
    assert.equal(denied.structuredContent, undefined);
  }
});

for (const finish of [null, "length", "content_filter"]) {
  test(`incomplete DeepSeek stream (${finish}) never yields a summary ID or a report`, async (t) => {
    const { client, store, profileId } = await fixture(t, finish);
    const search = store.saveSearch(profileId, "test", []);
    const result = await client.callTool({ name: "summarize_repositories", arguments: { searchResultId: search.searchResultId } });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent, undefined);
    assert.deepEqual(store.listReports(profileId), []);
  });
}

test("failed DeepSeek HTTP never fabricates a savable summary", async (t) => {
  const { client, store, profileId } = await fixture(t);
  const search = store.saveSearch(profileId, "test", []);
  t.mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 503 }));
  const result = await client.callTool({ name: "summarize_repositories", arguments: { searchResultId: search.searchResultId } });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent, undefined);
  assert.deepEqual(store.listReports(profileId), []);
});

for (const [name, damaged] of [
  ["malformed JSON", Buffer.from('data: {"choices":broken}\n\n')],
  ["invalid content type", Buffer.from('data: {"choices":[{"delta":{"content":42}}]}\n\n')],
  ["invalid UTF8", Buffer.concat([Buffer.from('data: {"choices":[{"delta":{"content":"'), Buffer.from([0xff]), Buffer.from('"}}]}\n\n')])],
] as const) {
  test(`damaged provider content (${name}) cannot become a saved summary even after stop`, async (t) => {
    const { client, store, profileId } = await fixture(t);
    const search = store.saveSearch(profileId, "test", []);
    t.mock.method(globalThis, "fetch", async () => new Response(Buffer.concat([
      Buffer.from('data: {"choices":[{"delta":{"content":"# Partial report\\n"}}]}\n\n'),
      damaged,
      Buffer.from('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'),
    ])));
    const result = await client.callTool({ name: "summarize_repositories", arguments: { searchResultId: search.searchResultId } });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent, undefined);
    assert.deepEqual(store.listReports(profileId), []);
  });
}

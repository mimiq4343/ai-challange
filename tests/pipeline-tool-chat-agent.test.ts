import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { McpToolEvent } from "../src/lib/mcp-chat-types";
import { McpToolChatAgent } from "../src/lib/mcp-tool-chat-agent";

const endpoint = "https://mcp.yees.ai/mcp/pipeline";
const token = "private-pipeline-credential-for-tests-only";
const searchId = "85daa3b0-8848-4cb0-8edc-5cc008d8910a";
const summaryId = "5948e138-c0ed-4fe8-ade0-0d4a0bfb3ef7";
const reportId = "772050e4-21ee-46db-81ef-7be986492e14";
const foreignId = "23ce33a1-f6ea-443c-8f9b-09f75a230679";
const names = ["search_repositories", "summarize_repositories", "save_to_file"];
const createdAt = "2026-09-27T00:00:00.000Z";
const data = [
  { searchResultId: searchId, query: "sqlite language:TypeScript", repositories: [], createdAt },
  { summaryId, searchResultId: searchId, markdown: "# Обзор\n\nРепозитории не найдены.\n", createdAt },
  { reportId, summaryId, searchResultId: searchId, query: "sqlite language:TypeScript", fileName: `${reportId}.md`, downloadUrl: `/api/pipeline/reports/${reportId}`, createdAt },
];
const calls = [
  { name: names[0], arguments: { query: "sqlite language:TypeScript" } },
  { name: names[1], arguments: { searchResultId: searchId } },
  { name: names[2], arguments: { summaryId } },
];
type Call = { name: string; arguments: Record<string, unknown> };
type ProviderRequest = {
  messages: Record<string, unknown>[];
  tools?: { function: { name: string } }[];
  tool_choice?: string;
  thinking?: { type: string };
};
const env = {
  NODE_ENV: "test" as const, OPENAI_BASE_URL: "https://provider.example/v1",
  OPENAI_API_KEY: "provider-key", OPENAI_MODEL: "deepseek-flash", MCP_PIPELINE_TOKEN: token,
};
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function selection(call: Call, index: number): Response {
  return stream({ reasoning_content: "private reasoning", tool_calls: [{
    index: 0, id: `step-${index}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) },
  }] }, "tool_calls");
}
function stream(delta: unknown, finish: string): Response {
  return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\ndata: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } })}\n\ndata: [DONE]\n\n`);
}
function final(): Response { return stream({ content: "Отчёт сохранён." }, "stop"); }
function agent(events: McpToolEvent[] = []) {
  return McpToolChatAgent.fromEnvironment({ endpoint, access: { kind: "pipeline", profileId: 7 }, onToolEvent: (event) => events.push(event) }, env);
}
function boundary(
  provider: (request: ProviderRequest, round: number) => Response = (_request, round) => round <= 3 ? selection(calls[round - 1], round) : final(),
  result: (call: Call, index: number) => Record<string, unknown> = (_call, index) => ({ content: [{ type: "text", text: JSON.stringify(data[index]) }], structuredContent: data[index] }),
) {
  const executions: Call[] = [];
  const requests: ProviderRequest[] = [];
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (String(input).startsWith("https://provider.example/")) {
      assert.equal(String(init?.body).includes(token), false);
      assert.equal(headers.get("X-Flash-Profile-Id"), null);
      const request = JSON.parse(String(init?.body));
      requests.push(request);
      return provider(request, requests.length);
    }
    assert.equal(String(input), endpoint);
    assert.equal(headers.get("Authorization"), `Bearer ${token}`);
    assert.equal(headers.get("X-Flash-Profile-Id"), "7");
    if (init?.method === "GET") return new Response(null, { status: 405 });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    const body = JSON.parse(String(init?.body));
    if (body.method.startsWith("notifications/")) return new Response(null, { status: 202 });
    let payload;
    if (body.method === "initialize") payload = { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "pipeline-test", version: "1" } };
    else if (body.method === "tools/list") payload = { tools: names.map((name) => ({ name, description: name, inputSchema: { type: "object" } })) };
    else if (body.method === "tools/call") { executions.push(body.params); payload = result(body.params, executions.length - 1); }
    else throw new Error(`Unexpected MCP method ${body.method}`);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: payload }), { headers: { "Content-Type": "application/json", "Mcp-Session-Id": "pipeline-session" } });
  };
  return { executions, requests };
}
const messages = [{ role: "user" as const, content: "Найди SQLite-библиотеки, сравни и сохрани отчёт." }];

test("pipeline completes the three model-selected stages and returns the confirmed downloadable report", async () => {
  const events: McpToolEvent[] = [];
  boundary();
  await assert.doesNotReject(async () => {
    const response = await agent(events).respond(messages, AbortSignal.timeout(5_000));
    assert.match(await new Response(response.stream).text(), new RegExp(`/api/pipeline/reports/${reportId}`));
    assert.equal((await response.usage)?.totalTokens, 52);
  });
  assert.equal(JSON.stringify(events).includes("private reasoning"), false);
  assert.equal(JSON.stringify(events).includes(token), false);
});

test("pipeline continues when the provider would otherwise choose an early text answer after search", async () => {
  boundary((request, round) => {
    if (round === 1) return selection(calls[0], round);
    if (round === 4) return final();
    // Контракт DeepSeek: auto допускает текст, required требует отключённого thinking.
    if (request.tool_choice !== "required") return final();
    if (request.thinking?.type !== "disabled") return new Response(null, { status: 400 });
    return selection(calls[round - 1], round);
  });
  await assert.doesNotReject(async () => {
    const response = await agent().respond(messages, AbortSignal.timeout(5_000));
    assert.match(await new Response(response.stream).text(), new RegExp(`/api/pipeline/reports/${reportId}`));
  });
});

test("pipeline rejects a skipped search before executing any write", async () => {
  const { executions } = boundary(() => selection(calls[2], 1));
  await assert.rejects(agent().respond(messages, AbortSignal.timeout(5_000)));
  assert.deepEqual(executions, []);
});

for (const stage of [1, 2]) {
  test(`pipeline refuses a different source identifier at stage ${stage + 1}`, async () => {
    const { executions } = boundary((_request, round) => {
      const index = round - 1;
      return selection(index === stage ? { name: calls[index].name, arguments: stage === 1 ? { searchResultId: foreignId } : { summaryId: foreignId } } : calls[index], round);
    });
    await assert.rejects(agent().respond(messages, AbortSignal.timeout(5_000)));
    assert.equal(executions.length, stage);
  });
}

test("pipeline rejects an early final answer instead of claiming an unsaved report is complete", async () => {
  const { executions } = boundary((_request, round) => round === 1 ? selection(calls[0], round) : final());
  await assert.rejects(agent().respond(messages, AbortSignal.timeout(5_000)));
  assert.equal(executions.length, 1);
});

test("pipeline stops at a tool error and exposes its failed result without calling later tools", async () => {
  const events: McpToolEvent[] = [];
  const { executions, requests } = boundary(undefined, () => ({ content: [{ type: "text", text: "GitHub rate limit" }], isError: true }));
  await assert.rejects(agent(events).respond(messages, AbortSignal.timeout(5_000)), /GitHub rate limit/);
  assert.equal(executions.length, 1);
  assert.equal(requests.length, 1);
  const failure = events.find((event) => event.type === "tool-result");
  assert.equal(failure?.type === "tool-result" && failure.result.isError, true);
});

test("pipeline rejects a summary result linked to another search before saving a file", async () => {
  const { executions } = boundary(undefined, (_call, index) => ({ content: [], structuredContent: index === 1 ? { ...data[index], searchResultId: foreignId } : data[index] }));
  await assert.rejects(agent().respond(messages, AbortSignal.timeout(5_000)));
  assert.equal(executions.length, 2);
});

test("pipeline never accepts a remote download URL from the tool result", async () => {
  const { executions } = boundary(undefined, (_call, index) => ({ content: [], structuredContent: index === 2 ? { ...data[index], downloadUrl: "https://foreign.example/report.md" } : data[index] }));
  await assert.rejects(agent().respond(messages, AbortSignal.timeout(5_000)));
  assert.equal(executions.length, 3);
});

test("pipeline rejects credentials bound to a foreign endpoint before network access", () => {
  const { executions, requests } = boundary();
  assert.throws(() => McpToolChatAgent.fromEnvironment({ endpoint: "https://foreign.example/mcp/pipeline", access: { kind: "pipeline", profileId: 7 }, onToolEvent() {} }, env));
  assert.deepEqual(executions, []);
  assert.deepEqual(requests, []);
});

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { McpToolEvent } from "../src/lib/mcp-chat-types";
import { McpToolChatAgent } from "../src/lib/mcp-tool-chat-agent";
import { MCP_PUBLIC_URL } from "../src/lib/mcp-config";
import { SCHEDULER_MCP_URL } from "../src/lib/scheduler-config";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const token = "private-scheduler-credential-for-tests-only";
const jobId = "c3c2c7aa-dfd3-4d26-a21b-91a82c81e780";
const names = ["create_repository_schedule", "list_repository_schedules", "stop_repository_schedule", "get_repository_summary"];
const tools = names.map((name) => ({
  name, description: name,
  inputSchema: { type: "object", properties: { profileId: { type: "number" } } },
}));
const env = {
  NODE_ENV: "test" as const,
  OPENAI_BASE_URL: "https://provider.example/v1", OPENAI_API_KEY: "provider-key", OPENAI_MODEL: "deepseek-flash",
  MCP_SCHEDULER_TOKEN: token,
};
const messages = [{ role: "user" as const, content: "Следи за example/project каждый час, покажи расписания и сводку, затем останови." }];
type ProviderRequest = { messages: Record<string, unknown>[]; tools: { function: { name: string; parameters: Record<string, unknown> } }[] };
type Call = { name: string; arguments: Record<string, unknown> };
const usage = { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 };

function sse(delta: unknown, finish: string): Response {
  return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\ndata: ${JSON.stringify({ choices: [], usage })}\n\ndata: [DONE]\n\n`);
}
function selection(calls: Call[], round = 1): Response {
  return sse({ reasoning_content: "private scheduler reasoning", tool_calls: calls.map((call, index) => ({
    index, id: `round-${round}-call-${index}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) },
  })) }, "tool_calls");
}
function answer(): Response { return sse({ content: "Мониторинг остановлен после получения сводки." }, "stop"); }
function agent(events: McpToolEvent[] = []) {
  return McpToolChatAgent.fromEnvironment({ endpoint: SCHEDULER_MCP_URL, access: { kind: "scheduler", profileId: 7 }, onToolEvent: (event) => events.push(event) }, env);
}
function boundary(
  provider: (request: ProviderRequest, round: number) => Response | Promise<Response>,
  discovered = tools,
) {
  const requests: ProviderRequest[] = [];
  const executions: Call[] = [];
  const results: unknown[] = [];
  const lifecycle: string[] = [];
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (String(input).startsWith("https://provider.example/")) {
      assert.equal(headers.get("Authorization"), "Bearer provider-key");
      assert.equal(headers.get("X-Flash-Profile-Id"), null);
      assert.equal(String(init?.body).includes(token), false);
      const body = JSON.parse(String(init?.body)) as ProviderRequest;
      requests.push(body);
      return provider(body, requests.length);
    }
    assert.equal(String(input), SCHEDULER_MCP_URL);
    assert.equal(headers.get("Authorization"), `Bearer ${token}`);
    assert.equal(headers.get("X-Flash-Profile-Id"), "7");
    assert.equal(String(init?.body).includes(token), false);
    if (init?.method === "GET") return new Response(null, { status: 405 });
    if (init?.method === "DELETE") { lifecycle.push("closed"); return new Response(null, { status: 204 }); }
    const body = JSON.parse(String(init?.body));
    lifecycle.push(body.method);
    if (body.method === "notifications/initialized" || body.method === "notifications/cancelled") return new Response(null, { status: 202 });
    let payload: unknown;
    if (body.method === "initialize") payload = { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "scheduler-test", version: "1" } };
    else if (body.method === "tools/list") payload = { tools: discovered };
    else if (body.method === "tools/call") {
      executions.push(body.params);
      const job = { id: jobId, owner: "example", repo: "project", intervalMinutes: 60, status: "active", createdAt: "2026-09-27T00:00:00.000Z", nextRunAt: "2026-09-27T00:00:00.000Z", lastRunAt: null };
      const data = body.params.name === "list_repository_schedules" ? { jobs: [job] }
        : body.params.name === "stop_repository_schedule" ? { job: { ...job, status: "stopped", nextRunAt: null } }
        : body.params.name === "get_repository_summary" ? { job, from: "2026-09-26T00:00:00.000Z", to: "2026-09-27T00:00:00.000Z", sampleCount: 0, failedRuns: 0, first: null, latest: null, starsChange: null, forksChange: null }
        : { job };
      payload = { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data, isError: false };
      results.push(payload);
    } else throw new Error(`Unexpected MCP method ${body.method}`);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: payload }), {
      headers: { "Content-Type": "application/json", "Mcp-Session-Id": "scheduler-session" },
    });
  };
  return { requests, executions, results, lifecycle };
}

const create = { name: "create_repository_schedule", arguments: { owner: "example", repo: "project", intervalMinutes: 60 } };
const list = { name: "list_repository_schedules", arguments: {} };
const summary = { name: "get_repository_summary", arguments: { jobId, periodHours: 24 } };
const stop = { name: "stop_repository_schedule", arguments: { jobId } };

test("scheduler executes model-selected create/list/summary/stop and feeds actual results into subsequent rounds", async () => {
  const events: McpToolEvent[] = [];
  const { requests, executions, results, lifecycle } = boundary((_request, round) => round === 1 ? selection([create, list]) : round === 2 ? selection([summary, stop], 2) : answer(), [...tools, { ...tools[0], name: "delete_repository" }]);
  const response = await agent(events).respond(messages, AbortSignal.timeout(5_000));
  assert.equal(await new Response(response.stream).text(), "Мониторинг остановлен после получения сводки.");
  assert.deepEqual(executions, [create, list, summary, stop]);
  assert.deepEqual(requests[0].tools.map((tool) => tool.function.name).sort(), [...names].sort());
  assert.equal(requests[0].tools.some((tool) => JSON.stringify(tool.function.parameters).includes("profileId")), false);
  assert.deepEqual(requests[1].messages.filter((message) => message.role === "tool").map((message) => JSON.parse(String(message.content))), results.slice(0, 2));
  assert.deepEqual(requests[2].messages.filter((message) => message.role === "tool").map((message) => JSON.parse(String(message.content))), results);
  assert.deepEqual(requests[2].messages.filter((message) => message.role === "assistant").map((message) => message.reasoning_content), ["private scheduler reasoning", "private scheduler reasoning"]);
  assert.deepEqual(events.filter((event) => event.type === "tool-start").map((event) => event.name), [create.name, list.name, summary.name, stop.name]);
  assert.equal(JSON.stringify(events).includes("private scheduler reasoning"), false);
  assert.equal(JSON.stringify(events).includes(token), false);
  assert.equal((await response.usage)?.totalTokens, 39);
  assert.equal(lifecycle.at(-1), "closed");
});

for (const invalid of [
  { name: "get_repository_info", arguments: { owner: "example", repo: "project" } },
  { name: "toString", arguments: {} },
  { name: "list_repository_schedules", arguments: { profileId: 99 } },
  { name: "create_repository_schedule", arguments: { ...create.arguments, intervalMinutes: 14 } },
  { name: "create_repository_schedule", arguments: { ...create.arguments, intervalMinutes: 10_081 } },
  { name: "create_repository_schedule", arguments: { ...create.arguments, intervalMinutes: 15.5 } },
  { name: "create_repository_schedule", arguments: { ...create.arguments, token } },
  { name: "stop_repository_schedule", arguments: { jobId, profileId: 99 } },
  { name: "get_repository_summary", arguments: { jobId, periodHours: 721 } },
  { name: "get_repository_summary", arguments: { jobId: "not-a-uuid" } },
]) {
  test(`scheduler validates the entire batch before mutation: ${JSON.stringify(invalid)}`, async () => {
    const events: McpToolEvent[] = [];
    const { executions } = boundary(() => selection([create, invalid]));
    await assert.rejects(agent(events).respond(messages, AbortSignal.timeout(5_000)));
    assert.deepEqual(executions, []);
    assert.deepEqual(events, []);
  });
}

for (const discovered of [tools.slice(1), [...tools, tools[0]]]) {
  test(`scheduler refuses ${discovered.length < 4 ? "missing" : "duplicate"} required discovery tools before contacting model`, async () => {
    const { requests, executions } = boundary(() => answer(), discovered);
    await assert.rejects(agent().respond(messages, AbortSignal.timeout(5_000)));
    assert.deepEqual(requests, []);
    assert.deepEqual(executions, []);
  });
}

for (const endpoint of [MCP_PUBLIC_URL, "https://foreign.example/mcp/scheduler", `${SCHEDULER_MCP_URL}/`, `${SCHEDULER_MCP_URL}?token=secret`, "https://mcp.yees.ai:443/mcp/scheduler"]) {
  test(`scheduler refuses non-exact endpoint before exposing credentials: ${endpoint}`, () => {
    const { lifecycle } = boundary(() => answer());
    assert.throws(() => McpToolChatAgent.fromEnvironment({ endpoint, access: { kind: "scheduler", profileId: 7 }, onToolEvent() {} }, env));
    assert.deepEqual(lifecycle, []);
  });
}

for (const profileId of [0, -1, 1.5, Number.NaN]) {
  test(`scheduler rejects invalid trusted profile: ${profileId}`, () => {
    assert.throws(() => McpToolChatAgent.fromEnvironment({ endpoint: SCHEDULER_MCP_URL, access: { kind: "scheduler", profileId }, onToolEvent() {} }, env));
  });
}

test("scheduler rejects missing token before opening either network connection", () => {
  const { requests, lifecycle } = boundary(() => answer());
  assert.throws(() => McpToolChatAgent.fromEnvironment({ endpoint: SCHEDULER_MCP_URL, access: { kind: "scheduler", profileId: 7 }, onToolEvent() {} }, { ...env, MCP_SCHEDULER_TOKEN: " " }));
  assert.deepEqual(requests, []);
  assert.deepEqual(lifecycle, []);
});

test("scheduler asks through the real model without inventing a mutation for an ambiguous request", async () => {
  const { executions } = boundary(() => sse({ content: "Какой репозиторий и какой интервал наблюдения?" }, "stop"));
  const response = await agent().respond([{ role: "user", content: "Начни следить за проектом." }], AbortSignal.timeout(5_000));
  assert.equal(await new Response(response.stream).text(), "Какой репозиторий и какой интервал наблюдения?");
  assert.deepEqual(executions, []);
});

test("cancelling after confirmed creation never dispatches an implicit rollback or retries mutation", async () => {
  const controller = new AbortController();
  const events: McpToolEvent[] = [];
  const { requests, executions } = boundary((_request, round) => {
    if (round === 1) return selection([create]);
    controller.abort();
    return answer();
  });
  await assert.rejects(agent(events).respond(messages, controller.signal), { name: "AbortError" });
  assert.deepEqual(executions, [create]);
  assert.equal(requests.length, 2);
  assert.deepEqual(events.map((event) => event.type), ["tool-start", "tool-result"]);
  const result = events[1];
  assert.equal(result.type === "tool-result" && result.result.isError, false);
});

test("a failed final model answer preserves the confirmed mutation and does not replay it", async () => {
  const events: McpToolEvent[] = [];
  const { executions } = boundary((_request, round) => round === 1 ? selection([create]) : new Response("private upstream error", { status: 503 }));
  await assert.rejects(agent(events).respond(messages, AbortSignal.timeout(5_000)), /503/);
  assert.deepEqual(executions, [create]);
  assert.deepEqual(events.map((event) => event.type), ["tool-start", "tool-result"]);
});

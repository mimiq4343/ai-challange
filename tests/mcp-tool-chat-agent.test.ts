import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { McpToolEvent } from "../src/lib/mcp-chat-types";
import { McpToolChatAgent } from "../src/lib/mcp-tool-chat-agent";
import { MCP_PUBLIC_URL, MCP_TOOL_CHAT_LIMITS } from "../src/lib/mcp-config";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const usage = { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13, prompt_cache_hit_tokens: 4, prompt_cache_miss_tokens: 6 };
const tool = {
  name: "get_repository_info",
  description: "Read a GitHub repository",
  inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" } }, required: ["owner", "repo"], additionalProperties: false },
};
const repositoryResult = {
  content: [{ type: "text", text: "Repository stars: 37" }],
  structuredContent: { fullName: "example/project", stars: 37 },
  isError: false,
};

type ProviderRequest = { messages: Record<string, unknown>[]; tools: { function: { name: string; parameters: unknown } }[] };
function sse(events: unknown[], done = true): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + (done ? "data: [DONE]\n\n" : ""));
}
function answer(text = "У example/project 37 звёзд.", tokenUsage: unknown = usage): Response {
  return sse([
    { choices: [{ index: 0, delta: { reasoning_content: "private final reasoning" }, finish_reason: null }] },
    { choices: [{ index: 0, delta: { content: text }, finish_reason: "stop" }] },
    { choices: [], usage: tokenUsage },
  ]);
}
function selection(id = "call-1", name = "get_repository_info", args = '{"owner":"example","repo":"project"}'): Response {
  return sse([
    { choices: [{ index: 0, delta: { reasoning_content: "private lookup reasoning" }, finish_reason: null }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: args.slice(0, 12) } }] }, finish_reason: null }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(12) } }] }, finish_reason: "tool_calls" }] },
    { choices: [], usage },
  ]);
}
function boundary(provider: (request: ProviderRequest, round: number, signal?: AbortSignal | null) => Response | Promise<Response>, result: unknown = repositoryResult) {
  const requests: ProviderRequest[] = [];
  const executions: unknown[] = [];
  const lifecycle: string[] = [];
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith("https://provider.example/")) {
      const body = JSON.parse(String(init?.body)) as ProviderRequest;
      requests.push(body);
      return provider(body, requests.length, init?.signal);
    }
    assert.equal(String(input), MCP_PUBLIC_URL);
    if (init?.method === "GET") return new Response(null, { status: 405 });
    if (init?.method === "DELETE") { lifecycle.push("closed"); return new Response(null, { status: 204 }); }
    const body = JSON.parse(String(init?.body));
    lifecycle.push(body.method);
    if (body.method === "notifications/initialized" || body.method === "notifications/cancelled") return new Response(null, { status: 202 });
    let payload: unknown;
    if (body.method === "initialize") payload = { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "github-test", version: "1" } };
    else if (body.method === "tools/list") payload = { tools: [tool, { ...tool, name: "delete_repository" }] };
    else if (body.method === "tools/call") { executions.push(body.params); payload = result; }
    else throw new Error(`Unexpected MCP method ${body.method}`);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: payload }), {
      headers: { "Content-Type": "application/json", "Mcp-Session-Id": "test-session" },
    });
  };
  return { requests, executions, lifecycle };
}
function agent(events: McpToolEvent[] = []) {
  return McpToolChatAgent.fromEnvironment({ endpoint: MCP_PUBLIC_URL, onToolEvent: (event) => events.push(event) }, {
    NODE_ENV: "test",
    OPENAI_BASE_URL: "https://provider.example/v1", OPENAI_API_KEY: "test-key", OPENAI_MODEL: "deepseek-flash",
  });
}
const messages = [{ role: "user" as const, content: "Сколько звёзд у example/project?" }];

test("executes only selected MCP calls and returns their result and private reasoning to the model", async () => {
  const events: McpToolEvent[] = [];
  const { requests, executions, lifecycle } = boundary((_request, round) => round === 1 ? selection() : answer());
  const instance = agent(events);
  assert.deepEqual(lifecycle, []);
  const response = await instance.respond(messages, AbortSignal.timeout(5_000), { systemMessages: ["profile", "invariants"] });
  assert.equal(await new Response(response.stream).text(), "У example/project 37 звёзд.");
  assert.deepEqual(executions, [{ name: "get_repository_info", arguments: { owner: "example", repo: "project" } }]);
  assert.deepEqual(requests[0].tools.map((item) => item.function.name), ["get_repository_info"]);
  assert.deepEqual(requests[0].tools[0].function.parameters, tool.inputSchema);
  assert.deepEqual(requests[1].messages.slice(-2), [
    { role: "assistant", content: "", reasoning_content: "private lookup reasoning", tool_calls: [{ id: "call-1", type: "function", function: { name: "get_repository_info", arguments: '{"owner":"example","repo":"project"}' } }] },
    { role: "tool", tool_call_id: "call-1", content: JSON.stringify(repositoryResult) },
  ]);
  assert.deepEqual(requests[0].messages.slice(0, 2), [{ role: "system", content: "profile" }, { role: "system", content: "invariants" }]);
  assert.deepEqual(events, [
    { type: "tool-start", callId: "call-1", name: "get_repository_info", arguments: { owner: "example", repo: "project" } },
    { type: "tool-result", callId: "call-1", result: repositoryResult },
  ]);
  assert.deepEqual(await response.usage, { promptTokens: 20, completionTokens: 6, totalTokens: 26, cacheHitTokens: 8, cacheMissTokens: 12 });
  assert.equal(await response.finishReason, "stop");
  assert.equal(lifecycle.at(-1), "closed");
});

test("does not invent a tool execution when the model answers directly", async () => {
  const events: McpToolEvent[] = [];
  const { executions } = boundary(() => answer("Здравствуйте!"));
  const response = await agent(events).respond(messages, AbortSignal.timeout(5_000));
  assert.equal(await new Response(response.stream).text(), "Здравствуйте!");
  assert.deepEqual(executions, []);
  assert.deepEqual(events, []);
});

test("passes an MCP isError result to the model and UI without fabricating success", async () => {
  const failure = { content: [{ type: "text", text: "GitHub returned 404" }], structuredContent: { status: 404 }, isError: true };
  const events: McpToolEvent[] = [];
  const { requests } = boundary((_request, round) => round === 1 ? selection() : answer("Репозиторий недоступен."), failure);
  const response = await agent(events).respond(messages, AbortSignal.timeout(5_000));
  assert.equal(await new Response(response.stream).text(), "Репозиторий недоступен.");
  assert.deepEqual(JSON.parse(String(requests[1].messages.at(-1)?.content)), failure);
  assert.deepEqual(events.at(-1), { type: "tool-result", callId: "call-1", result: failure });
});

test("leaves aggregate usage unknown when any provider round omits valid usage", async () => {
  boundary((_request, round) => round === 1 ? selection() : answer("Готово", null));
  const response = await agent().respond(messages, AbortSignal.timeout(5_000));
  assert.equal(await response.usage, null);
});

for (const [name, args] of [["delete_repository", '{}'], ["get_repository_info", '{'], ["get_repository_info", '{"owner":"example","repo":"../secret"}'], ["get_repository_info", '{"owner":"example","repo":"project","extra":true}']]) {
  test(`rejects unsafe tool selection before execution: ${name} ${args}`, async () => {
    const events: McpToolEvent[] = [];
    const { executions, lifecycle } = boundary(() => selection("bad-call", name, args));
    await assert.rejects(agent(events).respond(messages, AbortSignal.timeout(5_000)));
    assert.deepEqual(executions, []);
    assert.deepEqual(events, []);
    assert.equal(lifecycle.at(-1), "closed");
  });
}

test("bounds repeated tool rounds rather than saving a partial answer", async () => {
  const { requests, executions } = boundary((_request, round) => selection(`call-${round}`));
  await assert.rejects(agent().respond(messages, AbortSignal.timeout(5_000)), /лимит/i);
  assert.ok(requests.length <= MCP_TOOL_CHAT_LIMITS.maxRounds);
  assert.ok(executions.length <= MCP_TOOL_CHAT_LIMITS.maxToolCalls);
});

test("replays reasoning across the complete multi-tool loop", async () => {
  const { requests } = boundary((_request, round) => round < 3 ? selection(`call-${round}`) : answer());
  const response = await agent().respond(messages, AbortSignal.timeout(5_000));
  assert.equal(await new Response(response.stream).text(), "У example/project 37 звёзд.");
  assert.deepEqual(requests[2].messages.filter((message) => message.role === "assistant").map((message) => message.reasoning_content), ["private lookup reasoning", "private lookup reasoning"]);
  assert.equal((await response.usage)?.totalTokens, 39);
});

test("honors cancellation before MCP initialization", async () => {
  const { lifecycle, requests } = boundary(() => answer());
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(agent().respond(messages, controller.signal), { name: "AbortError" });
  assert.deepEqual(lifecycle, []);
  assert.deepEqual(requests, []);
});

test("cancels an unfinished provider stream and executes no queued tool", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const { executions } = boundary(() => new Response(new ReadableStream({
    start(stream) {
      stream.enqueue(new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}\n\n'));
      queueMicrotask(() => controller.abort());
    },
    cancel() { cancelled = true; },
  })));
  await assert.rejects(agent().respond(messages, controller.signal), { name: "AbortError" });
  assert.equal(cancelled, true);
  assert.deepEqual(executions, []);
});

for (const [label, response] of [
  ["output limit", () => sse([{ choices: [{ index: 0, delta: { content: "partial" }, finish_reason: "length" }] }])],
  ["truncated SSE", () => sse([{ choices: [{ index: 0, delta: { content: "partial" }, finish_reason: "stop" }] }], false)],
  ["malformed JSON", () => new Response('data: {broken}\n\ndata: [DONE]\n\n')],
  ["missing finish reason", () => sse([{ choices: [{ index: 0, delta: { content: "partial" }, finish_reason: null }] }])],
] as const) {
  test(`rejects ${label} without a persistable partial response`, async () => {
    boundary(response);
    await assert.rejects(agent().respond(messages, AbortSignal.timeout(5_000)));
  });
}

test("rejects foreign endpoints without network access", () => {
  const { lifecycle } = boundary(() => answer());
  assert.throws(() => McpToolChatAgent.fromEnvironment({ endpoint: "https://foreign.example/mcp", onToolEvent() {} }, {
    NODE_ENV: "test",
    OPENAI_BASE_URL: "https://provider.example/v1", OPENAI_API_KEY: "test-key", OPENAI_MODEL: "deepseek-flash",
  }));
  assert.deepEqual(lifecycle, []);
});

test("validates all calls in a batch before executing any of them", async () => {
  const { executions } = boundary(() => sse([{ choices: [{
    index: 0,
    delta: { tool_calls: [
      { index: 0, id: "valid", type: "function", function: { name: "get_repository_info", arguments: '{"owner":"example","repo":"project"}' } },
      { index: 1, id: "invalid", type: "function", function: { name: "delete_repository", arguments: "{}" } },
    ] },
    finish_reason: "tool_calls",
  }], usage }]));
  await assert.rejects(agent().respond(messages, AbortSignal.timeout(5_000)));
  assert.deepEqual(executions, []);
});

test("rejects duplicate call ids across model rounds without executing twice", async () => {
  const { executions } = boundary(() => selection("same-id"));
  await assert.rejects(agent().respond(messages, AbortSignal.timeout(5_000)));
  assert.equal(executions.length, 1);
});

test("rejects oversized results before exposing them to the model or UI", async () => {
  const events: McpToolEvent[] = [];
  const { requests } = boundary(() => selection(), { content: [{ type: "text", text: "x".repeat(MCP_TOOL_CHAT_LIMITS.maxToolResultBytes) }] });
  await assert.rejects(agent(events).respond(messages, AbortSignal.timeout(5_000)));
  assert.equal(requests.length, 1);
  assert.deepEqual(events.map((event) => event.type), ["tool-start"]);
});

test("rejects an oversized initial context before starting MCP", async () => {
  const { lifecycle } = boundary(() => answer());
  await assert.rejects(agent().respond([{ role: "user", content: "x".repeat(MCP_TOOL_CHAT_LIMITS.maxContextBytes) }], AbortSignal.timeout(5_000)));
  assert.deepEqual(lifecycle, []);
});

test("cancels an in-flight MCP call without retrying or publishing a result", async () => {
  const events: McpToolEvent[] = [];
  const controller = new AbortController();
  boundary(() => selection());
  const transportFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input) === MCP_PUBLIC_URL && init?.method === "POST" && JSON.parse(String(init.body)).method === "tools/call") {
      calls += 1;
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        queueMicrotask(() => controller.abort());
      });
    }
    return transportFetch(input, init);
  };
  await assert.rejects(agent(events).respond(messages, controller.signal), { name: "AbortError" });
  assert.equal(calls, 1);
  assert.deepEqual(events.map((event) => event.type), ["tool-start"]);
});

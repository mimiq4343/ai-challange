import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { discoverMcpTools, McpConnectionError, withMcpTools } from "../src/lib/mcp-client";
import { MCP_MAX_RESPONSE_BYTES, MCP_PUBLIC_URL } from "../src/lib/mcp-config";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("discovery and execution share one protected SDK session, including pagination and cleanup", async () => {
  const methods: string[] = [];
  const dispatchers: unknown[] = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), MCP_PUBLIC_URL);
    assert.equal(init?.redirect, "error");
    assert.equal(init?.credentials, "omit");
    assert.ok(init?.signal);
    const dispatcher = (init as RequestInit & { dispatcher: unknown }).dispatcher;
    dispatchers.push(dispatcher);
    if (init?.method === "GET") return new Response(null, { status: 405 });
    if (init?.method === "DELETE") { methods.push("close"); return new Response(null, { status: 204 }); }
    const message = JSON.parse(String(init?.body));
    methods.push(message.method);
    if (message.method === "notifications/initialized") return new Response(null, { status: 202 });
    let result: unknown;
    if (message.method === "initialize") result = { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "test", version: "1" } };
    else if (message.method === "tools/list") result = message.params?.cursor === "page-2"
      ? { tools: [{ name: "get_repository_info", inputSchema: { type: "object" } }] }
      : { tools: [{ name: "get_time", inputSchema: { type: "object" } }], nextCursor: "page-2" };
    else {
      assert.equal(message.method, "tools/call");
      assert.deepEqual(message.params, { name: "get_repository_info", arguments: { owner: "sample", repo: "project" } });
      result = { content: [{ type: "text", text: "not found" }], isError: true };
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }), { headers: { "Content-Type": "application/json", "Mcp-Session-Id": "one-session" } });
  };
  const result = await withMcpTools(MCP_PUBLIC_URL, AbortSignal.timeout(5_000), async (session) => {
    assert.deepEqual(session.tools.map((tool) => tool.name), ["get_time", "get_repository_info"]);
    return session.callTool("get_repository_info", { owner: "sample", repo: "project" });
  });
  assert.deepEqual(result, { content: [{ type: "text", text: "not found" }], isError: true });
  assert.deepEqual(methods, ["initialize", "notifications/initialized", "tools/list", "tools/list", "tools/call", "close"]);
  assert.ok(dispatchers[0]);
  assert.ok(dispatchers.every((dispatcher) => dispatcher === dispatchers[0]));
});

test("preserves the discovery API and refuses cyclic pagination", async () => {
  let closed = false;
  let pages = 0;
  globalThis.fetch = async (_input, init) => {
    if (init?.method === "GET") return new Response(null, { status: 405 });
    if (init?.method === "DELETE") { closed = true; return new Response(null, { status: 204 }); }
    const message = JSON.parse(String(init?.body));
    if (message.method === "notifications/initialized") return new Response(null, { status: 202 });
    const result = message.method === "initialize"
      ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "test", version: "1" } }
      : (pages += 1, { tools: [], nextCursor: "repeat" });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }), { headers: { "Content-Type": "application/json", "Mcp-Session-Id": "one-session" } });
  };
  await assert.rejects(discoverMcpTools(MCP_PUBLIC_URL), McpConnectionError);
  assert.equal(pages, 2);
  assert.equal(closed, true);
});

test("rejects an oversized decoded tools result rather than passing it to the consumer", async () => {
  let used = false;
  let closed = false;
  globalThis.fetch = async (_input, init) => {
    if (init?.method === "GET") return new Response(null, { status: 405 });
    if (init?.method === "DELETE") { closed = true; return new Response(null, { status: 204 }); }
    const message = JSON.parse(String(init?.body));
    if (message.method === "notifications/initialized") return new Response(null, { status: 202 });
    const result = message.method === "initialize"
      ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "test", version: "1" } }
      : { tools: [{ name: "too-large", description: "x".repeat(MCP_MAX_RESPONSE_BYTES), inputSchema: { type: "object" } }] };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }), { headers: { "Content-Type": "application/json", "Mcp-Session-Id": "one-session" } });
  };
  await assert.rejects(withMcpTools(MCP_PUBLIC_URL, AbortSignal.timeout(5_000), async () => { used = true; }), McpConnectionError);
  assert.equal(used, false);
  assert.equal(closed, true);
});

test("retains a consumer error while still releasing the MCP session", async () => {
  let closed = false;
  globalThis.fetch = async (_input, init) => {
    if (init?.method === "GET") return new Response(null, { status: 405 });
    if (init?.method === "DELETE") { closed = true; return new Response(null, { status: 204 }); }
    const message = JSON.parse(String(init?.body));
    if (message.method === "notifications/initialized") return new Response(null, { status: 202 });
    const result = message.method === "initialize"
      ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "test", version: "1" } }
      : { tools: [] };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }), { headers: { "Content-Type": "application/json", "Mcp-Session-Id": "one-session" } });
  };
  const expected = new Error("model failed");
  await assert.rejects(withMcpTools(MCP_PUBLIC_URL, AbortSignal.timeout(5_000), async () => { throw expected; }), (error) => error === expected);
  assert.equal(closed, true);
});

function paginatedServer(firstTool: Record<string, unknown>, toolResult: Record<string, unknown>) {
  const observed = { calls: 0, deleted: false };
  globalThis.fetch = async (_input, init) => {
    if (init?.method === "GET") return new Response(null, { status: 405 });
    if (init?.method === "DELETE") {
      assert.equal(init.signal?.aborted, false);
      observed.deleted = true;
      return new Response(null, { status: 204 });
    }
    const message = JSON.parse(String(init?.body));
    if (message.method === "notifications/initialized") return new Response(null, { status: 202 });
    let result: unknown;
    if (message.method === "initialize") {
      result = { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "test", version: "1" } };
    } else if (message.method === "tools/list") {
      result = message.params?.cursor
        ? { tools: [{ name: "last_page_tool", inputSchema: { type: "object" } }] }
        : { tools: [firstTool], nextCursor: "last" };
    } else {
      assert.equal(message.method, "tools/call");
      observed.calls += 1;
      result = toolResult;
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }), {
      headers: { "Content-Type": "application/json", "Mcp-Session-Id": "paged-session" },
    });
  };
  return observed;
}

test("validates output schemas for tools discovered before the last page", async () => {
  const observed = paginatedServer({
    name: "early_tool",
    inputSchema: { type: "object" },
    outputSchema: { type: "object", properties: { count: { type: "integer" } }, required: ["count"] },
  }, { content: [], structuredContent: { count: "not a number" } });
  await assert.rejects(
    withMcpTools(MCP_PUBLIC_URL, AbortSignal.timeout(5_000), (session) => session.callTool("early_tool", {})),
    McpConnectionError,
  );
  assert.equal(observed.calls, 1);
  assert.equal(observed.deleted, true);
});

test("refuses required-task tools from earlier pages without executing them", async () => {
  const observed = paginatedServer({
    name: "early_tool",
    inputSchema: { type: "object" },
    execution: { taskSupport: "required" },
  }, { content: [] });
  await assert.rejects(
    withMcpTools(MCP_PUBLIC_URL, AbortSignal.timeout(5_000), (session) => session.callTool("early_tool", {})),
    McpConnectionError,
  );
  assert.equal(observed.calls, 0);
  assert.equal(observed.deleted, true);
});

test("cancellation deletes the remote session with an independent live signal", async () => {
  const observed = paginatedServer({ name: "early_tool", inputSchema: { type: "object" } }, { content: [] });
  const abort = new AbortController();
  const reason = new DOMException("Cancelled by user", "AbortError");
  await assert.rejects(withMcpTools(MCP_PUBLIC_URL, abort.signal, async () => {
    abort.abort(reason);
  }), (error) => error === reason);
  assert.equal(observed.deleted, true);
});

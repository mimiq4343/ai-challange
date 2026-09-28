import assert from "node:assert/strict";
import { test } from "node:test";
import { withMcpTools } from "../src/lib/mcp-client";
import { PIPELINE_MCP_URL } from "../src/lib/pipeline-config";
import { SCHEDULER_MCP_URL } from "../src/lib/scheduler-config";

for (const scenario of [
  { name: "pipeline summary survives a sixteen-second response", endpoint: PIPELINE_MCP_URL, method: "tools/call", elapsed: 16_000, succeeds: true },
  { name: "pipeline summary still stops after its ninety-second deadline", endpoint: PIPELINE_MCP_URL, method: "tools/call", elapsed: 91_000, succeeds: false },
  { name: "pipeline discovery retains its shorter deadline", endpoint: PIPELINE_MCP_URL, method: "tools/list", elapsed: 16_000, succeeds: false },
  { name: "scheduler calls retain their existing deadline", endpoint: SCHEDULER_MCP_URL, method: "tools/call", elapsed: 16_000, succeeds: false },
]) {
  test(scenario.name, async (t) => {
    // Виртуальное время управляет реальными сигналами транспорта, без задержек теста.
    let now = 0;
    const deadlines: { at: number; controller: AbortController }[] = [];
    t.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
      const controller = new AbortController();
      deadlines.push({ at: now + milliseconds, controller });
      return controller.signal;
    });
    t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
      if (init?.method === "GET") return new Response(null, { status: 405 });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      const body = JSON.parse(String(init?.body));
      if (body.method.startsWith("notifications/")) return new Response(null, { status: 202 });
      if (body.method === scenario.method) {
        now += scenario.elapsed;
        for (const deadline of deadlines) {
          if (deadline.at <= now) deadline.controller.abort(new DOMException("Timed out", "TimeoutError"));
        }
        init?.signal?.throwIfAborted();
      }
      const result = body.method === "initialize"
        ? { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "deadline-test", version: "1" } }
        : body.method === "tools/list"
          ? { tools: [{ name: "summarize_repositories", inputSchema: { type: "object" } }] }
          : { content: [{ type: "text", text: "# Complete delayed report" }] };
      return Response.json({ jsonrpc: "2.0", id: body.id, result }, { headers: { "Mcp-Session-Id": "deadline-session" } });
    });
    const pending = withMcpTools(scenario.endpoint, new AbortController().signal,
      (session) => session.callTool("summarize_repositories", {}),
      { token: "test-pipeline-token-that-is-long-enough", profileId: 1 });
    if (scenario.succeeds) {
      await assert.doesNotReject(async () => {
        const result = await pending;
        assert.deepEqual(result.content, [{ type: "text", text: "# Complete delayed report" }]);
      });
    } else {
      await assert.rejects(pending);
    }
  });
}

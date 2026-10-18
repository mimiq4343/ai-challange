import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import fixtures from "../src/lib/support-fixtures.json";
import { handleSupportMessage, readSupportTicket } from "../src/lib/support-http";
import { consumeMcpChatStream } from "../src/lib/mcp-chat-stream";
import type { McpChatEvent } from "../src/lib/mcp-chat-types";
import { SupportStore } from "../src/lib/support-store";
import { McpToolChatAgent } from "../src/lib/mcp-tool-chat-agent";
import { ChatAgentError } from "../src/lib/chat-agent";

const previous = { ...process.env };
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...previous }; });
async function setup(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "support-http-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "src/lib"), { recursive: true });
  await writeFile(join(root, "src/lib/support-fixtures.json"), JSON.stringify(fixtures));
  process.env.OPENAI_BASE_URL = "https://provider.example/v1";
  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_MODEL = "deepseek-v4-flash";
  return root;
}
function request(body: unknown, origin = "http://localhost") {
  return new Request("http://localhost/api/support/tickets/SUP-101/messages", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
}
function sse(delta: unknown, finish = "stop") {
  return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`);
}
test("HTTP rejects client-supplied context, foreign origins, missing tickets and oversized input", async (t) => {
  const root = await setup(t);
  assert.equal((await handleSupportMessage(request({ content: "Вопрос", expectedCursor: null }, "https://evil.example"), "SUP-101", root)).status, 403);
  for (const extra of [{ history: [] }, { userId: "someone" }, { sources: [] }]) {
    assert.equal((await handleSupportMessage(request({ content: "Вопрос", expectedCursor: null, ...extra }), "SUP-101", root)).status, 400);
  }
  assert.equal((await handleSupportMessage(request({ content: "Вопрос", expectedCursor: null }), "SUP-999", root)).status, 404);
  assert.equal((await handleSupportMessage(request({ content: "x".repeat(20_000), expectedCursor: null }), "SUP-101", root)).status, 413);
});
test("real stdio tools execute; provider errors and missing knowledge never persist an exchange", async (t) => {
  const root = await setup(t);
  let rounds = 0;
  globalThis.fetch = async () => ++rounds === 1 ? sse({ tool_calls: [
    { index: 0, id: "ticket", type: "function", function: { name: "get_ticket", arguments: '{"ticketId":"SUP-101"}' } },
    { index: 1, id: "user", type: "function", function: { name: "get_user", arguments: '{"userId":"demo-anna"}' } },
    { index: 2, id: "search", type: "function", function: { name: "search_knowledge", arguments: '{"query":"авторизация MCP"}' } },
  ] }, "tool_calls") : new Response("provider private body", { status: 503 });
  const response = await handleSupportMessage(request({ content: "Почему не работает авторизация?", expectedCursor: null }), "SUP-101", root);
  const events: McpChatEvent[] = [];
  await assert.rejects(consumeMcpChatStream(response.body!, event => events.push(event)), /HTTP 503/);
  assert.equal(events.filter(event => event.type === "tool-result").length, 3);
  assert.ok(events.some(event => event.type === "tool-result" && event.result.isError));
  assert.equal(JSON.stringify(events).includes("provider private body"), false);
  assert.equal(events.some(event => event.type === "done"), false);
  const state = await readSupportTicket("SUP-101", root);
  assert.equal(state.exchanges.length, 0);
});
test("an unsupported answer without tool evidence is rejected and not saved", async (t) => {
  const root = await setup(t);
  globalThis.fetch = async () => sse({ content: "Я исправил авторизацию." });
  const response = await handleSupportMessage(request({ content: "Помоги", expectedCursor: null }), "SUP-101", root);
  await assert.rejects(consumeMcpChatStream(response.body!, () => undefined), /контекст/);
  assert.deepEqual((await readSupportTicket("SUP-101", root)).exchanges, []);
});

test("the server restores only this ticket's history and rejects a stale cursor before inference", async (t) => {
  const root = await setup(t);
  const store = new SupportStore(join(root, "data/support.sqlite"));
  const exchange = store.save("SUP-101", null, "Токен уже проверили", "Проверим источник отказа.", []);
  store.save("SUP-102", null, "Чужая переписка", "Не должна попасть в запрос.", []);
  store.close();
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.ok(body.messages.some((message: { content: string }) => message.content === exchange.question));
    assert.equal(JSON.stringify(body).includes("Чужая переписка"), false);
    return sse({ content: "Ответ без свежих источников." });
  };
  const stale = await handleSupportMessage(request({ content: "Что дальше?", expectedCursor: null }), "SUP-101", root);
  assert.equal(stale.status, 409); assert.equal(calls, 0);
  const response = await handleSupportMessage(request({ content: "Что дальше?", expectedCursor: exchange.id }), "SUP-101", root);
  await assert.rejects(consumeMcpChatStream(response.body!, () => undefined), /контекст/);
  assert.equal(calls, 1);
});

test("cancellation and an inference timeout commit nothing", async (t) => {
  const root = await setup(t);
  // В этом тесте изолируем внешний LLM+MCP; реальные протоколы проверяются выше.
  const originalRespond = McpToolChatAgent.prototype.respond;
  t.after(() => { McpToolChatAgent.prototype.respond = originalRespond; });
  const controller = new AbortController();
  let timeout = false;
  McpToolChatAgent.prototype.respond = async function (_messages, signal) {
    if (timeout) throw new ChatAgentError("Истекло время ожидания модели.", "upstream");
    controller.abort();
    signal.throwIfAborted();
    throw new Error("unreachable");
  };
  const cancelled = new Request(request({ content: "Вопрос", expectedCursor: null }), { signal: controller.signal });
  const response = await handleSupportMessage(cancelled, "SUP-101", root);
  await assert.rejects(consumeMcpChatStream(response.body!, () => undefined));
  assert.deepEqual((await readSupportTicket("SUP-101", root)).exchanges, []);
  timeout = true;
  const timedOut = await handleSupportMessage(request({ content: "Вопрос", expectedCursor: null }), "SUP-101", root);
  await assert.rejects(consumeMcpChatStream(timedOut.body!, () => undefined));
  assert.deepEqual((await readSupportTicket("SUP-101", root)).exchanges, []);
});

test("a completed grounded exchange and its sources are committed before the terminal event", async (t) => {
  const root = await setup(t);
  const source = { id: "S1", source: "docs/support/faq.md", section: "MCP", startLine: 1, endLine: 2, text: "Проверьте права MCP.", score: 0.9 };
  const original = McpToolChatAgent.fromEnvironment;
  t.after(() => { McpToolChatAgent.fromEnvironment = original; });
  McpToolChatAgent.fromEnvironment = options => {
    const agent = original(options);
    agent.respond = async () => {
      for (const [name, data] of [["get_ticket", { ticket: fixtures.tickets[0] }], ["get_user", { user: fixtures.users[0] }], ["search_knowledge", { results: [source], stale: false }]] as const) {
        options.onToolEvent({ type: "tool-start", callId: name, name, arguments: {} });
        options.onToolEvent({ type: "tool-result", callId: name, result: { content: [], structuredContent: data, isError: false } });
      }
      return { stream: new Response("Проверьте права MCP. [S1]").body!, finishReason: Promise.resolve("stop"), usage: Promise.resolve(null) };
    };
    return agent;
  };
  const response = await handleSupportMessage(request({ content: "Что делать?", expectedCursor: null }), "SUP-101", root);
  const events: McpChatEvent[] = [];
  await consumeMcpChatStream(response.body!, event => events.push(event));
  assert.equal(events.at(-1)?.type, "done");
  const state = await readSupportTicket("SUP-101", root);
  assert.equal(state.exchanges.length, 1);
  assert.equal(state.exchanges[0].question, "Что делать?");
  assert.deepEqual(state.exchanges[0].sources, [source]);
  assert.equal((await readSupportTicket("SUP-102", root)).exchanges.length, 0);
});

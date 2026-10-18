import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import fixtures from "../src/lib/support-fixtures.json";
import { parseSupportData, SupportDataError } from "../src/lib/support-data";
import { createSupportMcpServer } from "../src/lib/support-mcp-server";
import { SupportStore } from "../src/lib/support-store";
import { validateSupportAnswer } from "../src/lib/support-answer";
import type { McpToolEvent } from "../src/lib/mcp-chat-types";

test("JSON validates required fields, unique IDs and ticket ownership", () => {
  const data = parseSupportData(fixtures);
  assert.ok(data.users.length >= 2 && data.tickets.length >= 3);
  assert.throws(() => parseSupportData({ ...fixtures, users: [] }), SupportDataError);
  assert.throws(() => parseSupportData({ ...fixtures, users: [...fixtures.users, fixtures.users[0]] }), SupportDataError);
  assert.throws(() => parseSupportData({ ...fixtures, tickets: [{ ...fixtures.tickets[0], userId: "missing" }] }), SupportDataError);
});

test("MCP exposes read-only tools and prevents access to another user's tickets", async (t) => {
  const data = parseSupportData(fixtures);
  const selected = data.tickets[0];
  const foreign = data.tickets.find(ticket => ticket.userId !== selected.userId)!;
  const server = createSupportMcpServer(data, selected.id, async () => ({ results: [], stale: false }));
  const client = new Client({ name: "support-test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  t.after(async () => { await client.close(); await server.close(); });
  const catalog = await client.listTools();
  assert.deepEqual(catalog.tools.map(tool => tool.name).sort(), ["get_ticket", "get_user", "list_user_tickets", "search_knowledge"]);
  assert.ok(catalog.tools.every(tool => tool.annotations?.readOnlyHint));
  const own = await client.callTool({ name: "get_ticket", arguments: { ticketId: selected.id } });
  assert.equal(own.isError, undefined);
  assert.equal((own.structuredContent as { ticket: { id: string } }).ticket.id, selected.id);
  for (const [name, args] of [["get_ticket", { ticketId: foreign.id }], ["get_user", { userId: foreign.userId }], ["list_user_tickets", { userId: foreign.userId }]] as const) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, true);
    assert.equal(JSON.stringify(result).includes(foreign.description), false);
  }
  const ownList = await client.callTool({ name: "list_user_tickets", arguments: { userId: selected.userId } });
  assert.ok((ownList.structuredContent as { tickets: { userId: string }[] }).tickets.every(ticket => ticket.userId === selected.userId));
  const invalid = await client.callTool({ name: "get_ticket", arguments: { ticketId: selected.id, path: "/etc/passwd" } });
  assert.equal(invalid.isError, true);
});

test("completed exchange and sources survive reopening; stale writes never save a partial pair", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "flash-support-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "support.sqlite");
  const source = { id: "S1", source: "docs/support/faq.md", section: "История", startLine: 1, endLine: 3, text: "Сохраняется только полный ответ.", score: 0.9 };
  let store = new SupportStore(path);
  assert.deepEqual(store.read("SUP-101"), []);
  const exchange = store.save("SUP-101", null, "Где ответ?", "Оборванный ответ не сохраняется. [S1]", [source]);
  store.close(); store = new SupportStore(path);
  t.after(() => store.close());
  assert.deepEqual(store.read("SUP-101"), [exchange]);
  assert.deepEqual(store.read("SUP-102"), []);
  assert.throws(() => store.save("SUP-101", null, "stale", "answer", []), /изменился/);
  assert.throws(() => store.save("SUP-101", exchange.id, "question", " ", []), /пуст/);
  assert.equal(store.read("SUP-101").length, 1);
});

test("answer requires fresh ticket, user and knowledge evidence, and rejects fabricated citations", () => {
  const ticket = parseSupportData(fixtures).tickets[0];
  const tool = (name: string, structuredContent: Record<string, unknown>): McpToolEvent[] => [
    { type: "tool-start", callId: name, name, arguments: {} },
    { type: "tool-result", callId: name, result: { isError: false, content: [], structuredContent } },
  ];
  const source = { id: "S1", source: "docs/support/faq.md", section: "MCP", startLine: 1, endLine: 3, text: "Проверьте доступ MCP.", score: 0.9 };
  const events = [...tool("get_ticket", { ticket }), ...tool("get_user", { user: { id: ticket.userId } }), ...tool("search_knowledge", { results: [source], stale: false })];
  assert.deepEqual(validateSupportAnswer("Проверьте доступ. [S1]", ticket, events), [source]);
  assert.throws(() => validateSupportAnswer("Ответ [S99]", ticket, events), /источник/);
  assert.throws(() => validateSupportAnswer("Придуманный ответ", ticket, []), /контекст/);
  assert.throws(() => validateSupportAnswer("Ответ без ссылки", ticket, events), /ссылк/);
  const empty = [...tool("get_ticket", { ticket }), ...tool("get_user", { user: { id: ticket.userId } }), ...tool("search_knowledge", { results: [], stale: false })];
  assert.deepEqual(validateSupportAnswer("Не знаю: в базе знаний нет ответа. Какой код ошибки?", ticket, empty), []);
  assert.throws(() => validateSupportAnswer("Всё исправлено", ticket, empty), /знаний/);
});

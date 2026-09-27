import assert from "node:assert/strict";
import { test } from "node:test";

import { consumeMcpChatStream } from "../src/lib/mcp-chat-stream";
import type { McpChatEvent } from "../src/lib/mcp-chat-types";

function streamChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

const encoder = new TextEncoder();

test("MCP stream preserves UTF-8 and event boundaries when every byte arrives separately", async () => {
  const expected: McpChatEvent[] = [
    { type: "tool-start", callId: "call-1", name: "get_repository_info", arguments: { owner: "vercel", repo: "next.js" } },
    { type: "tool-result", callId: "call-1", result: { content: [{ type: "text", text: "Описание\nрепозитория" }], structuredContent: { stars: 42 }, isError: false } },
    { type: "metadata", headers: { "X-Token-Prompt": "120" } },
    { type: "text", delta: "Репозиторий готов." },
    { type: "done" },
  ];
  const bytes = encoder.encode(expected.map((event) => JSON.stringify(event)).join("\r\n"));
  const received: McpChatEvent[] = [];
  await consumeMcpChatStream(streamChunks(Array.from(bytes, (byte) => Uint8Array.of(byte))), (event) => received.push(event));
  assert.deepEqual(received, expected);
});

test("MCP stream rejects EOF without done even after valid answer text", async () => {
  for (const suffix of ["\n", ""]) {
    const received: McpChatEvent[] = [];
    await assert.rejects(
      consumeMcpChatStream(streamChunks([encoder.encode(`${JSON.stringify({ type: "text", delta: "Частичный ответ" })}${suffix}`)]), (event) => received.push(event)),
      /оборвался/,
    );
    assert.deepEqual(received, [{ type: "text", delta: "Частичный ответ" }]);
  }
});

test("MCP stream surfaces a terminal server error and cancels the unfinished reader", async () => {
  let canceled = false;
  const received: McpChatEvent[] = [];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('{"type":"error","message":"Проверьте адрес MCP-сервера."}\n{"type":"done"}\n'));
    },
    cancel() { canceled = true; },
  });
  await assert.rejects(consumeMcpChatStream(stream, (event) => received.push(event)), /Проверьте адрес MCP-сервера/);
  assert.equal(canceled, true);
  assert.equal(stream.locked, false);
  assert.equal(received.some((event) => event.type === "done"), false);
});

test("MCP stream rejects malformed or incomplete events instead of accepting a later done", async () => {
  for (const line of ['{"type":"text",', '{"type":"text","delta":42}', '{"type":"unknown"}']) {
    await assert.rejects(
      consumeMcpChatStream(streamChunks([encoder.encode(`${line}\n{"type":"done"}\n`)]), () => {}),
      /Некорректное событие/,
    );
  }
});

test("MCP stream treats tool errors as data so the final answer can still complete", async () => {
  const events: McpChatEvent[] = [
    { type: "tool-start", callId: "missing", name: "get_repository_info", arguments: { owner: "example", repo: "missing" } },
    { type: "tool-result", callId: "missing", result: { content: [{ type: "text", text: "Репозиторий не найден." }], isError: true } },
    { type: "text", delta: "Проверьте имя репозитория." },
    { type: "done" },
  ];
  const received: McpChatEvent[] = [];
  await consumeMcpChatStream(streamChunks([encoder.encode(`${events.map((event) => JSON.stringify(event)).join("\n")}\n`)]), (event) => received.push(event));
  assert.deepEqual(received, events);
});

test("MCP stream propagates transport rejection and releases the reader", async () => {
  const failure = new TypeError("connection reset");
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { controller.error(failure); },
  });
  await assert.rejects(consumeMcpChatStream(stream, () => {}), (error) => error === failure);
  assert.equal(stream.locked, false);
});

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { RagAgent, RagError } from "../src/lib/rag-agent";
import { indexDocuments } from "../src/lib/document-indexer";
import { SqliteDocumentStore } from "../src/lib/document-store";
import type { ChatMessage } from "../src/lib/chat-agent";
import type { CompressionLlmResponder } from "../src/lib/compression-llm";
import type { ChatRequestOptions } from "../src/lib/conversation-types";
import { RAG_EMBEDDING_CONFIG } from "../src/lib/rag-embedding-config";

const vector = [1, ...Array<number>(RAG_EMBEDDING_CONFIG.dimensions - 1).fill(0)];
const signal = () => new AbortController().signal;
const usage = { promptTokens: 40, completionTokens: 10, totalTokens: 50, cacheHitTokens: null, cacheMissTokens: null };

function llm(handler: (messages: readonly ChatMessage[], options?: ChatRequestOptions) => string, finish = "stop"): CompressionLlmResponder {
  return { model: "deepseek-v4-flash", async respond(messages, _signal, options) {
    return { stream: new Response(handler(messages, options)).body!, usage: Promise.resolve(usage), finishReason: Promise.resolve(finish) };
  } };
}

async function snapshot(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "flash-rag-"));
  const store = new SqliteDocumentStore(join(root, "index.sqlite"), RAG_EMBEDDING_CONFIG);
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  await writeFile(join(root, "guide.md"), "# Storage\nUse atomic transactions.\n");
  await indexDocuments({ root, store, config: RAG_EMBEDDING_CONFIG, countTokens: async (text) => text.length, sources: ["guide.md"], questions: [
    { id: "storage", question: "Как сохранять?", source: "guide.md", section: "Storage", evidence: "atomic" },
  ], client: { async embed(inputs) { return { vectors: inputs.map(() => vector), tokens: 1 }; } } });
  return store.readIndexVectors("structural");
}

test("plain mode answers without an index, embeddings or context from earlier calls", async () => {
  const agent = new RagAgent(llm((messages) => {
    assert.equal(messages.length, 1);
    return messages[0].content;
  }));
  assert.equal((await agent.respond("Первый вопрос", "plain", signal())).answer, "Первый вопрос");
  const next = await agent.respond("Второй вопрос", "plain", signal());
  assert.equal(next.answer, "Второй вопрос");
  assert.deepEqual(next.sources, []);
  assert.equal(next.indexId, null);
});

test("RAG sends retrieved text with source IDs and the original question to the LLM", async (t) => {
  const index = await snapshot(t);
  const agent = new RagAgent(llm((messages, options) => {
    assert.equal(messages.length, 1);
    assert.match(messages[0].content, /Как сохранять\?/);
    assert.match(messages[0].content, /Use atomic transactions/);
    assert.match(messages[0].content, /guide\.md/);
    assert.match(options!.systemMessages!.join("\n"), /инструкции/);
    return "В одной транзакции [S1].";
  }), { index, embedder: { async embed(inputs, inputType) {
    assert.deepEqual(inputs, ["Как сохранять?"]);
    assert.equal(inputType, "search_query");
    return { vectors: [vector], tokens: 4 };
  } } });
  const result = await agent.respond("Как сохранять?", "rag", signal());
  assert.equal(result.sources[0].id, "S1");
  assert.equal(result.sources[0].source, "guide.md");
  assert.equal(result.sources[0].score, 1);
  assert.equal("embedding" in result.sources[0], false);
  assert.equal(result.indexId, index.report!.id);
  assert.deepEqual(result.citations, ["S1"]);
  assert.deepEqual(result.invalidCitations, []);
  const plain = await new RagAgent(llm((messages) => messages[0].content), { index, embedder: {
    async embed() { throw new Error("plain must not embed"); },
  } }).respond("Как сохранять?", "plain", signal());
  assert.equal(plain.answer, "Как сохранять?");
});

test("RAG fails explicitly for missing or incompatible indexes, embedding errors and timeouts", async (t) => {
  const index = await snapshot(t);
  const never = llm(() => { assert.fail("must not call LLM"); });
  await assert.rejects(new RagAgent(never).respond("Вопрос", "rag", signal()), RagError);
  for (const badIndex of [{ report: null, chunks: [] }, { ...index, report: { ...index.report!, dimensions: 4 } }]) {
    await assert.rejects(new RagAgent(never, { index: badIndex, embedder: { async embed() { return { vectors: [vector], tokens: 1 }; } } }).respond("Вопрос", "rag", signal()), RagError);
  }
  for (const failure of [new Error("HTTP 429"), new DOMException("Timeout", "TimeoutError")]) {
    await assert.rejects(new RagAgent(never, { index, embedder: { async embed() { throw failure; } } }).respond("Вопрос", "rag", signal()), (error: unknown) => error instanceof RagError && error.cause === failure);
  }
});

test("truncated, empty or interrupted LLM output never becomes a completed answer", async () => {
  await assert.rejects(new RagAgent(llm(() => "partial", "length")).respond("Вопрос", "plain", signal()), /заверш/);
  await assert.rejects(new RagAgent(llm(() => " ")).respond("Вопрос", "plain", signal()), /пуст/);
  const interrupted: CompressionLlmResponder = { model: "deepseek-v4-flash", async respond() {
    return { stream: new ReadableStream({ start(controller) { controller.error(new Error("connection lost")); } }), usage: Promise.resolve(null), finishReason: Promise.resolve(null) };
  } };
  await assert.rejects(new RagAgent(interrupted).respond("Вопрос", "plain", signal()), /connection lost/);
});

test("local embedding failures preserve the cause and suggest preparing the local model", async (t) => {
  const index = await snapshot(t);
  const failure = new Error("model file missing");
  const agent = new RagAgent(llm(() => { assert.fail("must not call LLM"); }), { index, embedder: { async embed() { throw failure; } } });
  await assert.rejects(agent.respond("Вопрос", "rag", signal()), (error: unknown) => error instanceof RagError && error.message.includes("npm run rag:index") && error.cause === failure);
});

test("citations identify only retrieved source IDs and expose fabricated IDs", async (t) => {
  const index = await snapshot(t);
  const result = await new RagAgent(llm(() => "Транзакция [S1], неизвестный источник [S99]."), {
    index, embedder: { async embed() { return { vectors: [vector], tokens: 1 }; } },
  }).respond("Вопрос", "rag", signal());
  assert.deepEqual(result.citations, ["S1"]);
  assert.deepEqual(result.invalidCitations, ["S99"]);
});

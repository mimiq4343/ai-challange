import assert from "node:assert/strict";
import { test } from "node:test";
import { GroundedRagAgent } from "../src/lib/rag-grounding-agent";
import { RagError } from "../src/lib/rag-agent";
import { groundingLlm } from "./helpers/rag-grounding";
import { refinementIndex, testEmbedder, testSettings } from "./helpers/rag-refinement";

test("grounded answers include only cited sources and verbatim quotes from the selected context", async (t) => {
  const answer = await new GroundedRagAgent(groundingLlm(), { index: await refinementIndex(t), embedder: testEmbedder })
    .respond("Как сохраняются сообщения?", testSettings, new AbortController().signal);
  assert.equal(answer.status, "answered");
  assert.equal(answer.clarification, null);
  assert.equal(answer.result.answer, "Оба сообщения сохраняются атомарно [S1].");
  assert.equal(answer.result.sources[0].source, "guide.md");
  assert.equal(answer.result.sources[0].section, "Transactions");
  assert.deepEqual(answer.result.citations, ["S1"]);
  assert.equal(answer.quotes[0].text, "Atomic transactions commit both messages.");
  assert.equal(answer.quotes[0].chunkId, answer.result.sources[0].chunkId);
  assert.equal(answer.usage.totalTokens, 150);
});

test("below-threshold context returns unknown with clarification without a generation call", async (t) => {
  const llm = groundingLlm((prompt, payload) => {
    if (prompt.includes("RELEVANCE_RERANK")) return JSON.stringify({ results: JSON.parse(payload).candidates.map((item: { id: string }) => ({ id: item.id, score: 5, reason: "Нет ответа." })) });
    if (prompt.includes("GROUNDED_RAG_ANSWER")) assert.fail("Weak context must never reach generation");
  });
  const answer = await new GroundedRagAgent(llm, { index: await refinementIndex(t), embedder: testEmbedder })
    .respond("Как работает доставка?", testSettings, new AbortController().signal);
  assert.equal(answer.status, "unknown");
  assert.match(answer.result.answer, /Не знаю/);
  assert.ok(answer.clarification?.trim());
  assert.deepEqual(answer.result.sources, []);
  assert.deepEqual(answer.quotes, []);
  assert.equal(answer.result.usage.totalTokens, 0);
  assert.equal(answer.usage.totalTokens, 100);
});

test("unverifiable quotes, invented sources and missing evidence fail explicitly", async (t) => {
  const index = await refinementIndex(t);
  for (const mutation of ["quote", "source", "section", "chunk", "no_quotes", "no_sources", "foreign_reference", "no_reference", "unquoted_source", "extra", "empty", "json"]) {
    const llm = groundingLlm((prompt, payload) => {
      if (!prompt.includes("GROUNDED_RAG_ANSWER")) return;
      const source = JSON.parse(payload).context[0];
      const value = { status: "answered", answer: "Оба сообщения сохраняются атомарно [S1].", clarification: null,
        sources: [{ id: source.id, source: source.source, section: source.section, chunkId: source.chunkId }],
        quotes: [{ sourceId: source.id, text: "Atomic transactions commit both messages." }] };
      if (mutation === "json") return "not JSON";
      if (mutation === "quote") value.quotes[0].text = "Atomic transactions commit nothing.";
      if (mutation === "source") value.sources[0].source = "invented.md";
      if (mutation === "section") value.sources[0].section = "Invented";
      if (mutation === "chunk") value.sources[0].chunkId = "invented";
      if (mutation === "no_quotes") value.quotes = [];
      if (mutation === "no_sources") value.sources = [];
      if (mutation === "foreign_reference") value.answer += " [S99]";
      if (mutation === "no_reference") value.answer = "Сохраняются атомарно.";
      if (mutation === "unquoted_source") value.quotes[0].sourceId = "S99";
      if (mutation === "extra") Object.assign(value, { context: "injected" });
      if (mutation === "empty") value.answer = " ";
      return JSON.stringify(value);
    });
    await assert.rejects(new GroundedRagAgent(llm, { index, embedder: testEmbedder }).respond("Вопрос", testSettings, new AbortController().signal), RagError, mutation);
  }
});

test("a semantic lack of evidence returns explicit unknown and discards context as answer sources", async (t) => {
  const llm = groundingLlm((prompt) => prompt.includes("GROUNDED_RAG_ANSWER") ? JSON.stringify({ status: "unknown", answer: "Не знаю: в найденных фрагментах нет нужных сведений.", clarification: "Какой сценарий сохранения вас интересует?", sources: [], quotes: [] }) : undefined);
  const answer = await new GroundedRagAgent(llm, { index: await refinementIndex(t), embedder: testEmbedder }).respond("Вопрос", testSettings, new AbortController().signal);
  assert.equal(answer.status, "unknown");
  assert.deepEqual(answer.result.sources, []);
  assert.deepEqual(answer.quotes, []);
  assert.equal(answer.candidates.some((item) => item.decision === "selected"), true);
});

test("unknown clarification cannot introduce citations without evidence", async (t) => {
  const index = await refinementIndex(t);
  for (const reference of ["S1", "S99"]) {
    const llm = groundingLlm((prompt) => prompt.includes("GROUNDED_RAG_ANSWER") ? JSON.stringify({
      status: "unknown", answer: "Не знаю: найденных сведений недостаточно.",
      clarification: `Что означает [${reference}]?`, sources: [], quotes: [],
    }) : undefined);
    await assert.rejects(new GroundedRagAgent(llm, { index, embedder: testEmbedder })
      .respond("Вопрос", testSettings, new AbortController().signal), RagError, reference);
  }
});

test("truncated generation, missing usage, provider failure and cancellation never produce grounded success", async (t) => {
  const index = await refinementIndex(t);
  const delegate = groundingLlm();
  for (const fault of ["truncated", "usage", "provider"]) {
    const llm = { model: delegate.model, async respond(...args: Parameters<typeof delegate.respond>) {
      const result = await delegate.respond(...args);
      if (!args[2]?.systemMessages?.join("\n").includes("GROUNDED_RAG_ANSWER")) return result;
      if (fault === "provider") throw new Error("provider unavailable");
      return { ...result, finishReason: Promise.resolve(fault === "truncated" ? "length" : "stop"), usage: Promise.resolve(fault === "usage" ? null : await result.usage) };
    } };
    await assert.rejects(new GroundedRagAgent(llm, { index, embedder: testEmbedder }).respond("Вопрос", testSettings, new AbortController().signal));
  }
  const signal = AbortSignal.abort();
  await assert.rejects(new GroundedRagAgent(delegate, { index, embedder: testEmbedder }).respond("Вопрос", testSettings, signal), { name: "AbortError" });
});

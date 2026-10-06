import { RagRefinementAgent } from "../src/lib/rag-refinement-agent";
import assert from "node:assert/strict";
import { test } from "node:test";
import { RagError } from "../src/lib/rag-agent";
import { refinementIndex, refinementLlm, testEmbedder, testSettings } from "./helpers/rag-refinement";


test("refinement promotes evidence over a higher-similarity irrelevant chunk and never sends rejected text to generation", async (t) => {
  const index = await refinementIndex(t);
  const agent = new RagRefinementAgent(refinementLlm((prompt, payload) => {
    if (!prompt.includes("QUERY_REWRITE") && !prompt.includes("RELEVANCE_RERANK")) {
      assert.equal(payload.includes("Gardening"), false);
      assert.equal(payload.includes("Foreign keys"), false);
    }
    return undefined;
  }), { index, embedder: testEmbedder });
  const [result] = await agent.respond("Как сохраняются сообщения?", "refined", testSettings, new AbortController().signal);
  assert.equal(result.result.question, "Как сохраняются сообщения?");
  assert.deepEqual(result.result.sources.map((item) => item.section), ["Transactions"]);
  assert.deepEqual(result.result.citations, ["S1"]);
  assert.equal(result.candidates.length, 3);
  assert.equal(result.candidates.find((item) => item.source.text.includes("Gardening"))!.decision, "below_threshold");
  assert.equal(result.candidates.find((item) => item.source.text.includes("Atomic"))!.relevance, 10);
  assert.equal(result.usage.totalTokens, 150);
});

test("comparison keeps baseline untouched and reuses the exact rewritten query and candidates for the final two modes", async (t) => {
  const index = await refinementIndex(t);
  const agent = new RagRefinementAgent(refinementLlm(), { index, embedder: testEmbedder });
  const results = await agent.respond("Как сохраняются сообщения?", "compare", testSettings, new AbortController().signal);
  assert.deepEqual(results.map((item) => item.mode), ["baseline", "rewrite", "refined"]);
  assert.equal(results[0].query, "Как сохраняются сообщения?");
  assert.equal(results[0].stages.length, 0);
  assert.equal(results[0].result.sources[0].source, "noise.md");
  assert.equal(results[1].query, results[2].query);
  assert.deepEqual(results[1].candidates.map((item) => item.source.chunkId), results[2].candidates.map((item) => item.source.chunkId));
  assert.equal(results[1].stages[0].id, results[2].stages[0].id);
  assert.equal(results[2].result.sources[0].source, "guide.md");
});

test("comparison includes the shared rewrite in the final answer latency shown by the existing answer card", async (t) => {
  const index = await refinementIndex(t);
  const delegate = refinementLlm();
  const llm = { model: delegate.model, async respond(...args: Parameters<typeof delegate.respond>) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return delegate.respond(...args);
  } };
  const results = await new RagRefinementAgent(llm, { index, embedder: testEmbedder }).respond("Вопрос", "compare", testSettings, new AbortController().signal);
  assert.ok(results[2].result.durationMs >= 55, "Latency must include three external stages, including the shared rewrite");
  assert.equal(results[2].result.durationMs, results[2].durationMs);
});

test("threshold is inclusive, context top-k applies after reranking and excess relevant results have a distinct decision", async (t) => {
  const index = await refinementIndex(t);
  const responder = refinementLlm((prompt, payload) => {
    if (prompt.includes("QUERY_REWRITE")) return '{"query":"conversation transactions"}';
    if (prompt.includes("RELEVANCE_RERANK")) return JSON.stringify({ results: JSON.parse(payload).candidates.map((item: { id: string }) => ({ id: item.id, score: 6, reason: "Полезный контекст." })) });
    return "Ответ [S1].";
  });
  const [answer] = await new RagRefinementAgent(responder, { index, embedder: testEmbedder }).respond("Вопрос", "refined", testSettings, new AbortController().signal);
  assert.equal(answer.result.sources.length, 1);
  assert.equal(answer.candidates.filter((item) => item.decision === "below_threshold").length, 0);
  assert.equal(answer.candidates.filter((item) => item.decision === "outside_top_k").length, 2);
});

test("an empty filtered context stays empty and does not fall back to rejected sources", async (t) => {
  const index = await refinementIndex(t);
  const llm = refinementLlm((prompt, payload) => {
    if (prompt.includes("QUERY_REWRITE")) return '{"query":"DHL delivery"}';
    if (prompt.includes("RELEVANCE_RERANK")) return JSON.stringify({ results: JSON.parse(payload).candidates.map((item: { id: string }) => ({ id: item.id, score: 0, reason: "Нет сведений о доставке." })) });
    assert.deepEqual(JSON.parse(payload.split("CONTEXT_JSON\n")[1]), []);
    return "В найденных источниках нет сведений о доставке.";
  });
  const [answer] = await new RagRefinementAgent(llm, { index, embedder: testEmbedder }).respond("Как работает доставка DHL?", "refined", testSettings, new AbortController().signal);
  assert.deepEqual(answer.result.sources, []);
  assert.match(answer.result.answer, /нет сведений/);
});

test("invalid, missing, duplicate or invented reranker IDs fail instead of inventing relevance", async (t) => {
  const index = await refinementIndex(t);
  for (const malformed of ['{}', '{"results":[]}', '{"results":[{"id":"invented","score":10,"reason":"x"}]}', 'not json']) {
    const llm = refinementLlm((prompt) => prompt.includes("QUERY_REWRITE") ? '{"query":"transactions"}' : malformed);
    await assert.rejects(new RagRefinementAgent(llm, { index, embedder: testEmbedder }).respond("Вопрос", "refined", testSettings, new AbortController().signal), RagError);
  }
  const llm = refinementLlm((prompt, payload) => prompt.includes("QUERY_REWRITE") ? '{"query":"transactions"}' : JSON.stringify({ results: JSON.parse(payload).candidates.map(() => ({ id: "C1", score: 11, reason: "x" })) }));
  await assert.rejects(new RagRefinementAgent(llm, { index, embedder: testEmbedder }).respond("Вопрос", "refined", testSettings, new AbortController().signal), RagError);
});

test("rewriting preserves code identifiers and fails explicitly when they disappear", async (t) => {
  const index = await refinementIndex(t);
  const llm = refinementLlm(() => '{"query":"conversation history"}');
  await assert.rejects(new RagRefinementAgent(llm, { index, embedder: testEmbedder }).respond("Откуда PersistentChatAgent берёт историю?", "rewrite", testSettings, new AbortController().signal), /идентификатор/);
});

test("reranker rejects complete lists containing duplicate IDs, foreign IDs, fractional scores or empty reasons", async (t) => {
  const index = await refinementIndex(t);
  for (const mutation of ["duplicate", "foreign", "fraction", "reason"]) {
    const llm = refinementLlm((prompt, payload) => {
      if (prompt.includes("QUERY_REWRITE")) return '{"query":"transactions"}';
      const rows = JSON.parse(payload).candidates.map((item: { id: string }) => ({ id: item.id, score: 6, reason: "Подтверждает ответ." }));
      if (mutation === "duplicate") rows[1].id = rows[0].id;
      if (mutation === "foreign") rows[0].id = "unknown";
      if (mutation === "fraction") rows[0].score = 6.5;
      if (mutation === "reason") rows[0].reason = " ";
      return JSON.stringify({ results: rows });
    });
    await assert.rejects(new RagRefinementAgent(llm, { index, embedder: testEmbedder }).respond("Вопрос", "refined", testSettings, new AbortController().signal), RagError);
  }
});

test("a timeout aborts an in-flight external stage without another request", async (t) => {
  const index = await refinementIndex(t);
  const llm = { model: "deepseek-v4-flash", async respond(_messages: unknown, signal: AbortSignal): Promise<never> {
    signal.throwIfAborted();
    return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  } };
  await assert.rejects(new RagRefinementAgent(llm, { index, embedder: testEmbedder }).respond("Вопрос", "rewrite", testSettings, AbortSignal.timeout(20)), { name: "TimeoutError" });
});

test("failed and truncated stages preserve errors, and cancellation stops before another LLM call", async (t) => {
  const index = await refinementIndex(t);
  const failure = new Error("provider unavailable");
  await assert.rejects(new RagRefinementAgent({ model: "deepseek-v4-flash", async respond() { throw failure; } }, { index, embedder: testEmbedder }).respond("Вопрос", "rewrite", testSettings, new AbortController().signal), (error: unknown) => error === failure);
  await assert.rejects(new RagRefinementAgent(refinementLlm(undefined, "length"), { index, embedder: testEmbedder }).respond("Вопрос", "refined", testSettings, new AbortController().signal), RagError);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(new RagRefinementAgent(refinementLlm(() => assert.fail("LLM must not run")), { index, embedder: testEmbedder }).respond("Вопрос", "compare", testSettings, controller.signal), { name: "AbortError" });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { RagAgent, RagError } from "../src/lib/rag-agent";
import { ragResponse } from "../src/lib/rag-http";

const request = (body: string) => new Request("http://localhost/api/rag", { method: "POST", body });

test("RAG HTTP boundary rejects malformed, oversized, unknown modes and extra context fields before LLM calls", async () => {
  const never = () => { assert.fail("must not create agent"); };
  for (const body of ["{", "null", "[]", "{}", JSON.stringify({ question: " ", mode: "rag" }), JSON.stringify({ question: "a".repeat(4001), mode: "plain" }), JSON.stringify({ question: "x", mode: "other" }), JSON.stringify({ question: "x", mode: "rag", context: "invented" })]) {
    assert.equal((await ragResponse(request(body), never)).status, 400);
  }
  assert.equal((await ragResponse(request("a".repeat(24001)), never)).status, 413);
});

test("plain HTTP requests work without document credentials and return completed usage", async () => {
  const agent = new RagAgent({ model: "deepseek-v4-flash", async respond(messages) {
    return { stream: new Response(messages[0].content).body!, usage: Promise.resolve({ promptTokens: 2, completionTokens: 1, totalTokens: 3, cacheHitTokens: null, cacheMissTokens: null }), finishReason: Promise.resolve("stop") };
  } });
  const response = await ragResponse(request(JSON.stringify({ question: "Вопрос", mode: "plain" })), () => agent);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const payload = await response.json();
  assert.equal(payload.answers[0].answer, "Вопрос");
  assert.deepEqual(payload.answers[0].sources, []);
  assert.equal(payload.answers[0].usage.totalTokens, 3);
});

test("missing index is an explicit service error rather than fabricated RAG output", async () => {
  const response = await ragResponse(request(JSON.stringify({ question: "Вопрос", mode: "rag" })), () => { throw new RagError("Индекс отсутствует.", 503); });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Индекс отсутствует." });
});

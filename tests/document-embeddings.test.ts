import assert from "node:assert/strict";
import { test } from "node:test";
import { DocumentEmbeddingClient } from "../src/lib/document-embeddings";

const vector = (first: number) => [first, ...Array<number>(2047).fill(0)];

test("batch embeddings preserve input order when the provider returns reordered indexes", async () => {
  const client = new DocumentEmbeddingClient("test-key", async (_url, init) => {
    const body = JSON.parse(String(init.body));
    assert.deepEqual(body.input, ["Документ один", "Document two"]);
    assert.equal(body.input_type, "search_document");
    assert.equal(body.model, "nvidia/nemotron-3-embed-1b:free");
    return Response.json({ object: "list", model: body.model, data: [
      { object: "embedding", index: 1, embedding: vector(2) },
      { object: "embedding", index: 0, embedding: vector(1) },
    ], usage: { prompt_tokens: 9, total_tokens: 9, cost: 0 } });
  });
  const result = await client.embed(["Документ один", "Document two"], "search_document");
  assert.equal(result.vectors[0][0], 1);
  assert.equal(result.vectors[1][0], 2);
  assert.equal(result.tokens, 9);
});

test("invalid dimensions, indexes, vectors and usage cannot enter the index", async () => {
  const cases = [
    { data: [{ index: 0, embedding: [1, 2] }], usage: { prompt_tokens: 1 } },
    { data: [{ index: 1, embedding: vector(1) }], usage: { prompt_tokens: 1 } },
    { data: [{ index: 0, embedding: Array<number>(2048).fill(0) }], usage: { prompt_tokens: 1 } },
    { data: [{ index: 0, embedding: vector(1) }], usage: {} },
    { data: [{ index: 0, embedding: vector(1) }], usage: { prompt_tokens: -1 } },
    { data: [], usage: { prompt_tokens: 1 } },
  ];
  for (const response of cases) {
    const client = new DocumentEmbeddingClient("test-key", async () => Response.json({ object: "list", model: "nvidia/nemotron-3-embed-1b:free", ...response, usage: { cost: 0, ...response.usage } }));
    await assert.rejects(client.embed(["Text"], "search_document"));
  }
});

test("the verified provider model alias is accepted, while a different model or nonzero cost fails", async () => {
  const payload = { model: "private/openrouter/nvidia/nemotron-3-embed-1b", data: [{ index: 0, embedding: vector(1) }], usage: { prompt_tokens: 1, cost: 0 } };
  const client = new DocumentEmbeddingClient("test-key", async () => Response.json(payload));
  assert.equal((await client.embed(["Text"], "search_document")).vectors.length, 1);
  for (const response of [{ ...payload, model: "different-model" }, { ...payload, usage: { prompt_tokens: 1, cost: 1 } }, { ...payload, usage: { prompt_tokens: 1 } }]) {
    await assert.rejects(new DocumentEmbeddingClient("test-key", async () => Response.json(response)).embed(["Text"], "search_document"));
  }
});

test("HTTP errors, malformed JSON and timeouts fail explicitly without retry or leaking credentials", async () => {
  let calls = 0;
  const limited = new DocumentEmbeddingClient("private-key", async () => { calls++; return Response.json({ error: { message: "private-key" } }, { status: 429 }); });
  await assert.rejects(limited.embed(["Text"], "search_document"), (error: Error) => /429/.test(error.message) && !error.message.includes("private-key"));
  assert.equal(calls, 1);
  const invalid = new DocumentEmbeddingClient("test-key", async () => new Response("invalid JSON"));
  await assert.rejects(invalid.embed(["Text"], "search_document"));
  const timedOut = new DocumentEmbeddingClient("test-key", async () => { throw new DOMException("Deadline", "TimeoutError"); });
  await assert.rejects(timedOut.embed(["Text"], "search_document"), /OpenRouter/);
  assert.throws(() => new DocumentEmbeddingClient("  "), /OPENROUTER_API_KEY/);
});

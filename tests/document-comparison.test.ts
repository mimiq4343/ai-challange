import assert from "node:assert/strict";
import { test } from "node:test";
import { compareDocumentStrategy, validateRetrievalQuestions } from "../src/lib/document-comparison";
import type { EmbeddedChunk, RetrievalQuestion } from "../src/lib/document-types";

const question: RetrievalQuestion = { id: "storage", question: "Как сохраняются данные?", source: "guide.md", section: "Storage", evidence: "transaction" };
function chunk(id: string, text: string, embedding: number[], source = "guide.md"): EmbeddedChunk {
  return { chunkId: id, source, strategy: "fixed", title: "Guide", section: "Storage", text, embedding,
    sourceHash: "hash", contentHash: id, start: 0, end: text.length, startLine: 1, endLine: 1,
    tokenCount: 10, boundaryCrossings: 1 };
}

test("cosine ranking checks source and evidence, with HitRate@5 and reciprocal rank", () => {
  const chunks = [chunk("wrong-source", "transaction", [4, 0], "other.md"), chunk("relevant", "atomic transaction", [1, 1]), chunk("wrong-evidence", "cache", [0, 1])];
  const result = compareDocumentStrategy("fixed", chunks, [question], [[1, 0]], 100, 2);
  assert.deepEqual(result.retrieval[0].hits.map((hit) => [hit.chunkId, hit.relevant]), [["wrong-source", false], ["relevant", true], ["wrong-evidence", false]]);
  assert.equal(result.hitRateAt5, 1);
  assert.equal(result.mrrAt5, 0.5);
  assert.equal(result.vectorBytes, 24);
  assert.equal(result.boundaryCrossingChunks, 3);
  assert.deepEqual(result.tokens, { min: 10, max: 10, mean: 10, total: 30 });
});

test("a relevant result beyond top five is a miss and invalid evaluation data fails", () => {
  const chunks = Array.from({ length: 5 }, (_, i) => chunk(String(i), "cache", [1, 0]));
  chunks.push(chunk("sixth", "transaction", [0, 1]));
  const result = compareDocumentStrategy("fixed", chunks, [question], [[1, 0]], 0, 2);
  assert.equal(result.retrieval[0].hits.length, 5);
  assert.equal(result.retrieval[0].rank, null);
  assert.equal(result.hitRateAt5, 0);
  assert.equal(result.mrrAt5, 0);
  assert.throws(() => compareDocumentStrategy("fixed", [], [question], [[1, 0]], 0, 2));
  assert.throws(() => compareDocumentStrategy("fixed", chunks, [question], [[0, 0]], 0, 2));
  assert.throws(() => compareDocumentStrategy("fixed", chunks, [question], [], 0, 2));
});

test("ground truth must reference an existing source, section and evidence", () => {
  const documents = [{ source: "guide.md", title: "Guide", text: "# Guide\n## Storage\natomic transaction\n", sourceHash: "hash" }];
  assert.doesNotThrow(() => validateRetrievalQuestions(documents, [question]));
  for (const change of [{ source: "missing.md" }, { section: "Missing" }, { evidence: "invented" }, { question: "" }]) {
    assert.throws(() => validateRetrievalQuestions(documents, [{ ...question, ...change }]));
  }
  assert.throws(() => validateRetrievalQuestions(documents, []));
  assert.throws(() => validateRetrievalQuestions(documents, [question, question]));
});

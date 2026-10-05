import assert from "node:assert/strict";
import { test } from "node:test";
import { rankDocumentChunks } from "../src/lib/document-comparison";
import type { EmbeddedChunk } from "../src/lib/document-types";

const chunk = (chunkId: string, embedding: number[]): EmbeddedChunk => ({
  chunkId, embedding, strategy: "structural", source: "guide.md", title: "Guide", section: "Storage", text: chunkId,
  sourceHash: "hash", contentHash: "hash", start: 0, end: 1, startLine: 1, endLine: 1, tokenCount: 1, boundaryCrossings: 0,
});

test("retrieval ranks by cosine rather than vector magnitude, limits top-k and breaks ties stably", () => {
  const hits = rankDocumentChunks([chunk("far", [0, 100]), chunk("b", [2, 0]), chunk("a", [1, 0]), chunk("near", [1, 1])], [1, 0], 2, 3);
  assert.deepEqual(hits.map((hit) => hit.chunk.chunkId), ["a", "b", "near"]);
  assert.equal(hits[0].score, 1);
  assert.ok(Math.abs(hits[2].score - Math.SQRT1_2) < 1e-10);
});

test("retrieval rejects empty, zero-norm or mismatched vectors", () => {
  for (const query of [[], [0, 0], [1], [NaN, 1]]) {
    assert.throws(() => rankDocumentChunks([chunk("a", [1, 0])], query, 2, 5));
  }
  assert.throws(() => rankDocumentChunks([], [1, 0], 2, 5));
  assert.throws(() => rankDocumentChunks([chunk("a", [1])], [1, 0], 2, 5));
});

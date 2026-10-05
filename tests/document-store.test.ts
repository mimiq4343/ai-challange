import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SqliteDocumentStore } from "../src/lib/document-store";
import type { DocumentIndexReport, EmbeddedChunk } from "../src/lib/document-types";

function run(id: string): { report: DocumentIndexReport; chunks: EmbeddedChunk[] } {
  const chunks = (["fixed", "structural"] as const).map((strategy): EmbeddedChunk => ({
    chunkId: `${id}-${strategy}`, strategy, source: "guide.md", title: "Guide", section: "Guide / Storage",
    text: "Atomic transactions.", sourceHash: "source-hash", contentHash: "content-hash",
    start: 0, end: 20, startLine: 1, endLine: 1, tokenCount: 3, boundaryCrossings: 0,
    embedding: [1, ...Array<number>(2047).fill(0)],
  }));
  return { chunks, report: {
    id, createdAt: "2026-10-05T00:00:00.000Z", model: "nvidia/nemotron-3-embed-1b:free", dimensions: 2048,
    corpus: { hash: "corpus-hash", files: 1, characters: 20, lines: 1, estimatedPages: 1, charactersPerPage: 3000 },
    chunking: { maxTokens: 384, overlapTokens: 64 }, providerRequests: 1, providerTokens: 6,
    comparison: (["fixed", "structural"] as const).map((strategy) => ({ strategy, chunks: 1,
      tokens: { min: 3, max: 3, mean: 3, total: 3 }, boundaryCrossingChunks: 0, embeddingMs: 10,
      vectorBytes: 8192, hitRateAt5: 1, mrrAt5: 1, retrieval: [],
    })),
  } };
}

test("completed index, Float32 vectors and metadata survive reopening the database", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "flash-document-store-"));
  const path = join(directory, "documents.sqlite");
  const store = new SqliteDocumentStore(path);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const built = run("first");
  store.replaceIndex(built.report, built.chunks);
  store.close();
  const reopened = new SqliteDocumentStore(path);
  t.after(() => reopened.close());
  assert.deepEqual(reopened.latestReport(), built.report);
  const page = reopened.listChunks("structural", { offset: 0, limit: 20, source: null });
  assert.equal(page.total, 1);
  assert.equal(page.chunks[0].section, "Guide / Storage");
  assert.equal("embedding" in page.chunks[0], false);
  assert.deepEqual(reopened.readVectors("fixed")[0].embedding, built.chunks[0].embedding);
  assert.deepEqual(reopened.listSources(), ["guide.md"]);
});

test("an invalid new index leaves the previous index intact and a successful run replaces both strategies", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "flash-document-store-"));
  const store = new SqliteDocumentStore(join(directory, "documents.sqlite"));
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  const first = run("first");
  store.replaceIndex(first.report, first.chunks);
  const broken = run("broken");
  broken.chunks[1].embedding = [1, 2];
  assert.throws(() => store.replaceIndex(broken.report, broken.chunks));
  assert.equal(store.latestReport()!.id, "first");
  const duplicate = run("duplicate");
  duplicate.chunks[1].chunkId = duplicate.chunks[0].chunkId;
  assert.throws(() => store.replaceIndex(duplicate.report, duplicate.chunks));
  assert.equal(store.latestReport()!.id, "first");
  assert.equal(store.readVectors("fixed")[0].chunkId, "first-fixed");
  const next = run("next");
  store.replaceIndex(next.report, next.chunks);
  assert.equal(store.latestReport()!.id, "next");
  assert.deepEqual(store.readVectors("fixed").map((chunk) => chunk.chunkId), ["next-fixed"]);
  assert.deepEqual(store.readVectors("structural").map((chunk) => chunk.chunkId), ["next-structural"]);
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runRagBenchmark, saveRagBenchmark } from "../src/lib/rag-benchmark";
import { indexDocuments } from "../src/lib/document-indexer";
import { SqliteDocumentStore } from "../src/lib/document-store";
import type { CompressionLlmResponder } from "../src/lib/compression-llm";
import { RAG_EMBEDDING_CONFIG } from "../src/lib/rag-embedding-config";

test("ten questions run both isolated modes and a blind judge; failed runs preserve the previous report", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "flash-rag-benchmark-"));
  const store = new SqliteDocumentStore(join(root, "index.sqlite"), RAG_EMBEDDING_CONFIG);
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  await writeFile(join(root, "guide.md"), "# Guide\nAtomic transaction.\n");
  const vector = [1, ...Array<number>(RAG_EMBEDDING_CONFIG.dimensions - 1).fill(0)];
  const embedder = { async embed(inputs: readonly string[]) { return { vectors: inputs.map(() => vector), tokens: 1 }; } };
  await indexDocuments({ root, store, config: RAG_EMBEDDING_CONFIG, countTokens: async (text) => text.length, sources: ["guide.md"], questions: [{ id: "storage", question: "Где?", source: "guide.md", section: "Guide", evidence: "Atomic" }], client: embedder });
  const questions = Array.from({ length: 10 }, (_, i) => ({ id: `q${i}`, question: `Вопрос ${i}?`, expectedFacts: ["Expected fact only the judge may see"], source: "guide.md", section: "Guide", evidence: "Atomic" }));
  const llm: CompressionLlmResponder = { model: "deepseek-v4-flash", async respond(messages, _signal, options) {
    const judging = options!.systemMessages![0].includes("судья");
    if (!judging) assert.equal(messages[0].content.includes("Expected fact only the judge may see"), false);
    else {
      const payload = JSON.parse(messages[0].content);
      assert.equal("mode" in payload, false);
      assert.ok(payload.reference.expectedFacts.includes("Expected fact only the judge may see"));
    }
    const scores = { factualAccuracy: 8, completeness: 8, instructionFollowing: 8, overall: 8 };
    const answer = judging ? JSON.stringify({ a: scores, b: scores, winner: "tie", rationale: "Оба ответа совпадают с эталоном." }) : "Atomic transaction [S1].";
    return { stream: new Response(answer).body!, usage: Promise.resolve({ promptTokens: 40, completionTokens: 10, totalTokens: 50, cacheHitTokens: null, cacheMissTokens: null }), finishReason: Promise.resolve("stop") };
  } };
  const completed: number[] = [];
  const options = { llm, index: store.readIndexVectors("structural"), embedder, questions, signal: new AbortController().signal, onCase: (_item: unknown, position: number) => { completed.push(position); } };
  const report = await runRagBenchmark(options);
  assert.equal(report.cases.length, 10);
  assert.deepEqual(completed, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(report.cases.every((item) => item.retrievalHit && item.plain.sources.length === 0 && item.rag.sources.length === 1), true);
  const path = join(root, "report.json");
  await saveRagBenchmark(report, path);
  const saved = await readFile(path, "utf8");
  assert.deepEqual(JSON.parse(saved), report);
  await assert.rejects(runRagBenchmark({ ...options, llm: { model: "deepseek-v4-flash", async respond() { throw new Error("provider unavailable"); } } }));
  assert.equal(await readFile(path, "utf8"), saved);
});

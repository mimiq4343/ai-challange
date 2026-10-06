import { runRefinementBenchmark, saveRefinementBenchmark, readRefinementBenchmark, acquireRefinementBenchmarkLock } from "../src/lib/rag-refinement-benchmark";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { refinementIndex, refinementLlm, refinementQuestions, testEmbedder, testSettings } from "./helpers/rag-refinement";


test("all modes share one snapshot; only a blind judge sees expectations and shared stages are billed once", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "refinement-report-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const index = await refinementIndex(t);
  const questions = refinementQuestions();
  let generationLeak = false;
  const score = { factualAccuracy: 8, completeness: 7, instructionFollowing: 9, overall: 8 };
  const llm = refinementLlm((prompt, payload) => {
    if (!prompt.includes("BLIND_REFINEMENT_JUDGE")) generationLeak ||= payload.includes("Judge-only expectation");
    if (prompt.includes("QUERY_REWRITE")) return '{"query":"Atomic transactions"}';
    if (prompt.includes("RELEVANCE_RERANK")) return JSON.stringify({ results: JSON.parse(payload).candidates.map((item: { id: string; text: string }) => ({ id: item.id, score: item.text.includes("Atomic") ? 9 : 0, reason: "Проверено по тексту." })) });
    if (prompt.includes("BLIND_REFINEMENT_JUDGE")) {
      const input = JSON.parse(payload);
      assert.ok(input.reference.expectedFacts.includes("Judge-only expectation"));
      assert.equal(payload.includes('"mode"'), false);
      return JSON.stringify({ a: score, b: score, c: score, winner: "tie", rationale: "Сверено с эталоном." });
    }
    return "Atomic transactions [S1].";
  });
  const completed: number[] = [];
  const options = { llm, index, embedder: testEmbedder, questions, settings: testSettings, signal: new AbortController().signal,
    onCase: (_item: unknown, position: number) => completed.push(position) };
  const report = await runRefinementBenchmark(options);
  assert.equal(generationLeak, false);
  assert.equal(report.cases.length, 12);
  assert.deepEqual(completed, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(report.cases[0].retrievalHits.baseline, false);
  assert.equal(report.cases[0].retrievalHits.refined, true);
  assert.equal(report.cases[10].retrievalHits.refined, null);
  assert.equal(report.cases[0].usage.totalTokens, 300);
  assert.equal(report.cases.every((item) => item.answers.every((answer) => answer.result.indexId === report.indexId)), true);
  const path = join(root, "report.json");
  await saveRefinementBenchmark(report, path);
  assert.deepEqual(await readRefinementBenchmark(path), report);
  const saved = await readFile(path, "utf8");
  await assert.rejects(saveRefinementBenchmark({ ...report, cases: report.cases.slice(0, 11) }, path));
  assert.equal(await readFile(path, "utf8"), saved);
  await assert.rejects(runRefinementBenchmark({ ...options, llm: { model: "deepseek-v4-flash", async respond() { throw new Error("provider unavailable"); } } }));
  assert.equal(await readFile(path, "utf8"), saved);
});

test("a benchmark lock excludes concurrent runs and is released for the next run", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "refinement-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "run.lock");
  const release = await acquireRefinementBenchmarkLock(path);
  await assert.rejects(acquireRefinementBenchmarkLock(path), /уже выполняется/);
  await release();
  await (await acquireRefinementBenchmarkLock(path))();
});

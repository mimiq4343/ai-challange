import assert from "node:assert/strict";
import fs, { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runGroundingBenchmark, saveGroundingBenchmark, readGroundingBenchmark, acquireGroundingBenchmarkLock } from "../src/lib/rag-grounding-benchmark";
import { groundingLlm, groundingQuestions } from "./helpers/rag-grounding";
import { refinementIndex, testEmbedder, testSettings } from "./helpers/rag-refinement";

test("ten corpus questions and two negative controls verify quotes and semantic support without leaking references", async (t) => {
  const index = await refinementIndex(t);
  let leaked = false;
  const llm = groundingLlm((prompt, payload) => {
    if (!prompt.includes("GROUNDING_JUDGE")) leaked ||= payload.includes("Judge-only expectation");
    if (prompt.includes("RELEVANCE_RERANK") && JSON.parse(payload).question.includes("вне корпуса")) return JSON.stringify({ results: JSON.parse(payload).candidates.map((item: { id: string }) => ({ id: item.id, score: 0, reason: "Не относится к вопросу." })) });
    if (prompt.includes("GROUNDING_JUDGE")) {
      const input = JSON.parse(payload);
      assert.ok(input.reference.expectedFacts.includes("Judge-only expectation"));
      return JSON.stringify({ supported: true, rationale: "Цитаты подтверждают ответ; отказ честный.", unsupportedClaims: [] });
    }
  });
  const positions: number[] = [];
  const report = await runGroundingBenchmark({ llm, index, embedder: testEmbedder, questions: groundingQuestions(), settings: testSettings,
    signal: new AbortController().signal, onCase: (_item, position) => positions.push(position) });
  assert.equal(leaked, false);
  assert.deepEqual(positions, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(report.cases.slice(0, 10).every((item) => item.checks.hasSources && item.checks.hasQuotes && item.checks.verbatimQuotes && item.checks.supported), true);
  assert.equal(report.cases.slice(10).every((item) => item.answer.status === "unknown" && item.checks.validUnknown && !item.checks.hasSources && !item.checks.hasQuotes), true);
  assert.equal(report.cases[0].usage.totalTokens, 200);
  assert.equal(report.cases[10].usage.totalTokens, 150);
  assert.equal(report.cases.every((item) => item.answer.result.indexId === report.indexId), true);
  const root = await mkdtemp(join(tmpdir(), "grounding-report-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "report.json");
  await saveGroundingBenchmark(report, path);
  assert.deepEqual(await readGroundingBenchmark(path), report);
  const saved = await readFile(path, "utf8");
  await assert.rejects(saveGroundingBenchmark({ ...report, cases: report.cases.slice(0, 11) }, path));
  const corrupt = structuredClone(report);
  corrupt.cases[0].answer.quotes[0].text = "invented quotation";
  await assert.rejects(saveGroundingBenchmark(corrupt, path));
  const corruptCitations = structuredClone(report);
  corruptCitations.cases[0].answer.result.citations = ["S99"];
  await assert.rejects(saveGroundingBenchmark(corruptCitations, path));
  assert.equal(await readFile(path, "utf8"), saved);
});

test("a semantic mismatch stays visible in the report and malformed judge output fails", async (t) => {
  const index = await refinementIndex(t);
  const options = { index, embedder: testEmbedder, questions: groundingQuestions(), settings: testSettings, signal: new AbortController().signal };
  const report = await runGroundingBenchmark({ ...options, llm: groundingLlm((prompt) => prompt.includes("GROUNDING_JUDGE") ? JSON.stringify({ supported: false, rationale: "Ответ приписал источнику неподтверждённое поведение.", unsupportedClaims: ["Сохраняется полный диалог."] }) : undefined) });
  assert.equal(report.cases.every((item) => !item.checks.supported), true);
  assert.deepEqual(report.cases[0].judge.unsupportedClaims, ["Сохраняется полный диалог."]);
  for (const output of ["{}", '{"supported":true,"rationale":"ok","unsupportedClaims":["unsupported"]}', '{"supported":false,"rationale":"ok","unsupportedClaims":[]}', "not JSON"]) {
    await assert.rejects(runGroundingBenchmark({ ...options, llm: groundingLlm((prompt) => prompt.includes("GROUNDING_JUDGE") ? output : undefined) }));
  }
});

test("cancellation during report commit restores previous bytes or leaves no first report", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "grounding-commit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const report = await runGroundingBenchmark({ index: await refinementIndex(t), embedder: testEmbedder,
    questions: groundingQuestions(), settings: testSettings, signal: new AbortController().signal, llm: groundingLlm() });
  const originalRename = fs.rename;
  let cancelCommit: AbortController | undefined;
  t.mock.method(fs, "rename", async (...args: Parameters<typeof fs.rename>) => {
    await originalRename(...args);
    const controller = cancelCommit;
    cancelCommit = undefined;
    controller?.abort();
  });
  for (const hasPrevious of [true, false]) {
    const path = join(root, hasPrevious ? "existing.json" : "first.json");
    const previous = Buffer.from("previous report\n");
    if (hasPrevious) await writeFile(path, previous);
    const controller = new AbortController();
    cancelCommit = controller;
    await assert.rejects(saveGroundingBenchmark(report, path, controller.signal), { name: "AbortError" });
    if (hasPrevious) assert.deepEqual(await readFile(path), previous);
    else await assert.rejects(readFile(path), { code: "ENOENT" });
    assert.deepEqual(await readdir(root), ["existing.json"]);
  }
});

test("grounding benchmark lock excludes concurrent runs and is reusable after release", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "grounding-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "run.lock");
  const release = await acquireGroundingBenchmarkLock(path);
  await assert.rejects(acquireGroundingBenchmarkLock(path), /уже выполняется/);
  await release();
  await (await acquireGroundingBenchmarkLock(path))();
});

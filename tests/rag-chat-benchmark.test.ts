import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readRagChatBenchmark, runRagChatBenchmark, saveRagChatBenchmark } from "../src/lib/rag-chat-benchmark";
import { groundingLlm } from "./helpers/rag-grounding";
import { refinementIndex, testEmbedder, testSettings } from "./helpers/rag-refinement";
import type { RagChatScenario } from "../src/lib/rag-chat-scenarios";

test("two 12-turn scenarios use persisted memory, isolate conversations and keep expectations only in the judge", async (t) => {
  const scenarios: RagChatScenario[] = ["Первый аудит", "Второй аудит"].map((goal, i) => ({ id: `s${i}`, title: goal, goal,
    turns: Array.from({ length: 12 }, (_, turn) => ({ content: turn === 0 ? `Цель: ${goal}` : "Продолжай аудит", requirements: ["JUDGE_ONLY_EXPECTATION"], expectUnknown: false })) }));
  const llm = groundingLlm((prompt, payload) => {
    if (!prompt.includes("RAG_CHAT_JUDGE")) assert.ok(!payload.includes("JUDGE_ONLY_EXPECTATION"));
    if (prompt.includes("RAG_TASK_MEMORY")) {
      const input = JSON.parse(payload);
      return JSON.stringify({ goal: input.content.startsWith("Цель:") ? { value: input.content.slice(6), evidenceId: input.evidenceOptions[0].id } : null, upsert: [], remove: [], question: "Как сохранять?" });
    }
    if (prompt.includes("RAG_CHAT_JUDGE")) return JSON.stringify({ goalRetained: true, constraintsRespected: true, termsCorrect: true, followsQuestion: true, supported: true, rationale: "Цель сохранена; цитата подтверждает ответ." });
  });
  const report = await runRagChatBenchmark({ llm, index: await refinementIndex(t), embedder: testEmbedder, settings: testSettings, scenarios, signal: new AbortController().signal });
  assert.equal(report.scenarios.length, 2);
  for (let i = 0; i < 2; i++) {
    const scenario = report.scenarios[i];
    assert.equal(scenario.turns.length, 12);
    assert.equal(scenario.restoredAfterReopen, true);
    assert.ok(scenario.turns.every((turn) => turn.taskState.goal?.value === scenarios[i].goal));
    assert.ok(scenario.turns.every((turn) => turn.checks.hasSources && turn.checks.verbatimQuotes));
  }
  const directory = await mkdtemp(join(tmpdir(), "flash-rag-chat-report-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "report.json");
  assert.equal(await readRagChatBenchmark(path), null);
  await saveRagChatBenchmark(report, path);
  assert.deepEqual(await readRagChatBenchmark(path), report);
  const bytes = await readFile(path, "utf8");
  await assert.rejects(saveRagChatBenchmark({ ...report, scenarios: report.scenarios.slice(0, 1) }, path), /не завершён/);
  await assert.rejects(saveRagChatBenchmark(report, path, AbortSignal.abort()), { name: "AbortError" });
  assert.equal(await readFile(path, "utf8"), bytes);
});

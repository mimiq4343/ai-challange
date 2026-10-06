import { refinementBenchmarkResponse, refinementResponse } from "../src/lib/rag-refinement-http";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { RagRefinementAgent } from "../src/lib/rag-refinement-agent";
import { acquireRefinementBenchmarkLock, runRefinementBenchmark, saveRefinementBenchmark } from "../src/lib/rag-refinement-benchmark";
import { refinementIndex, refinementLlm, refinementQuestions, testEmbedder, testSettings } from "./helpers/rag-refinement";

const request = (body: string) => new Request("http://localhost/api/rag/refinement", { method: "POST", body });

test("refinement HTTP rejects invalid modes, injected context and invalid top-k or threshold before creating an agent", async () => {
  const never = () => assert.fail("Invalid requests must not create an agent");
  const valid = { question: "Вопрос", mode: "refined", settings: testSettings };
  for (const body of ["{", "null", "[]", "{}", JSON.stringify({ ...valid, context: [] }), JSON.stringify({ ...valid, mode: "plain" }), JSON.stringify({ ...valid, question: " " }),
    ...[{ candidateK: 0, contextK: 1, minRelevance: 6 }, { candidateK: 2, contextK: 3, minRelevance: 6 }, { candidateK: 20, contextK: 5, minRelevance: 11 }, { candidateK: 20, contextK: 5, minRelevance: 6.5 }, { candidateK: 20, contextK: 5 }, { ...testSettings, extra: true }].map((settings) => JSON.stringify({ ...valid, settings }))]) {
    assert.equal((await refinementResponse(request(body), never)).status, 400);
  }
  assert.equal((await refinementResponse(request("a".repeat(24001)), never)).status, 413);
});

test("refinement HTTP returns three isolated completed answers and preserves stage usage and settings", async (t) => {
  const agent = new RagRefinementAgent(refinementLlm(), { index: await refinementIndex(t), embedder: testEmbedder });
  const response = await refinementResponse(request(JSON.stringify({ question: "Как сохранять?", mode: "compare", settings: testSettings })), () => agent);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const payload = await response.json();
  assert.equal(payload.answers.length, 3);
  assert.equal(payload.answers[2].result.sources[0].section, "Transactions");
  assert.deepEqual(payload.answers[2].settings, testSettings);
  assert.equal(payload.answers[2].usage.totalTokens, 150);
});

test("a cancelled HTTP request returns cancellation without running inference", async () => {
  const controller = new AbortController();
  controller.abort();
  const response = await refinementResponse(new Request("http://localhost/api/rag/refinement", { method: "POST", body: JSON.stringify({ question: "Вопрос", mode: "refined", settings: testSettings }), signal: controller.signal }), () => assert.fail("Cancelled request must not create an agent"));
  assert.equal(response.status, 499);
});

test("the NDJSON benchmark saves only a complete report and consumer cancellation preserves the previous file and releases its lock", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "refinement-stream-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "report.json");
  const lockPath = join(root, "run.lock");
  const index = await refinementIndex(t);
  const dependencies = {
    run: (settings: typeof testSettings, signal: AbortSignal, onCase?: Parameters<typeof runRefinementBenchmark>[0]["onCase"]) => runRefinementBenchmark({ settings, signal, onCase, index, embedder: testEmbedder, llm: refinementLlm(), questions: refinementQuestions() }),
    save: (report: Awaited<ReturnType<typeof runRefinementBenchmark>>, signal: AbortSignal) => saveRefinementBenchmark(report, path, signal),
    lock: () => acquireRefinementBenchmarkLock(lockPath),
  };
  const response = await refinementBenchmarkResponse(request(JSON.stringify({ settings: testSettings })), dependencies);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type")!, /application\/x-ndjson/);
  const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(events[0].type, "start");
  assert.equal(events.filter((event) => event.type === "case").length, 12);
  assert.equal(events.at(-1).type, "complete");
  assert.equal(JSON.parse(await readFile(path, "utf8")).cases.length, 12);
  const saved = await readFile(path, "utf8");
  const cancelled = await refinementBenchmarkResponse(request(JSON.stringify({ settings: testSettings })), dependencies);
  const reader = cancelled.body!.getReader();
  const decoder = new TextDecoder();
  let partial = "";
  while (!partial.includes('"type":"case"')) partial += decoder.decode((await reader.read()).value);
  await reader.cancel();
  assert.equal(await readFile(path, "utf8"), saved);
  await assert.rejects(readFile(lockPath), { code: "ENOENT" });
  await (await dependencies.lock())();
});

test("a provider failure produces an error event, logs once and leaves a saved benchmark untouched", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "refinement-failed-stream-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "report.json");
  await writeFile(path, "previous report\n");
  const index = await refinementIndex(t);
  const logs: unknown[] = [];
  t.mock.method(console, "error", (event: unknown) => logs.push(event));
  const response = await refinementBenchmarkResponse(request(JSON.stringify({ settings: testSettings })), {
    run: (settings, signal, onCase) => runRefinementBenchmark({ settings, signal, onCase, index, embedder: testEmbedder, questions: refinementQuestions(), llm: { model: "deepseek-v4-flash", async respond() { throw new Error("provider unavailable"); } } }),
    save: (report, signal) => saveRefinementBenchmark(report, path, signal),
    lock: () => acquireRefinementBenchmarkLock(join(root, "run.lock")),
  });
  const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(events.map((event) => event.type), ["start", "error"]);
  assert.equal(await readFile(path, "utf8"), "previous report\n");
  assert.equal(logs.length, 1);
});

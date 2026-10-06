import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { GroundedRagAgent } from "../src/lib/rag-grounding-agent";
import { acquireGroundingBenchmarkLock, runGroundingBenchmark, saveGroundingBenchmark } from "../src/lib/rag-grounding-benchmark";
import { groundingResponse, groundingBenchmarkResponse } from "../src/lib/rag-grounding-http";
import { groundingLlm, groundingQuestions } from "./helpers/rag-grounding";
import { refinementIndex, testEmbedder, testSettings } from "./helpers/rag-refinement";

const request = (body: unknown) => new Request("http://localhost/api/rag/grounded", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

test("grounding HTTP rejects client-supplied context, malformed requests and invalid settings", async () => {
  const never = () => assert.fail("Invalid input must not create an agent");
  const valid = { question: "Вопрос", settings: testSettings };
  for (const body of ["{", "null", "[]", {}, { ...valid, context: [] }, { ...valid, sources: [] }, { ...valid, question: " " }, { ...valid, settings: { ...testSettings, minRelevance: 6.5 } }]) {
    assert.equal((await groundingResponse(request(body), never)).status, 400);
  }
  assert.equal((await groundingResponse(request("a".repeat(24_001)), never)).status, 413);
  const controller = new AbortController();
  controller.abort();
  assert.equal((await groundingResponse(new Request("http://localhost/api/rag/grounded", { method: "POST", body: JSON.stringify(valid), signal: controller.signal }), never)).status, 499);
});

test("grounding HTTP exposes completed evidence and preserves explicit refusal as a successful response", async (t) => {
  const index = await refinementIndex(t);
  const answer = await groundingResponse(request({ question: "Вопрос", settings: testSettings }), () => new GroundedRagAgent(groundingLlm(), { index, embedder: testEmbedder }));
  assert.equal(answer.status, 200);
  assert.equal(answer.headers.get("Cache-Control"), "no-store");
  const payload = await answer.json();
  assert.equal(payload.answer.status, "answered");
  assert.equal(payload.answer.quotes[0].text, "Atomic transactions commit both messages.");
  const llm = groundingLlm((prompt, body) => prompt.includes("RELEVANCE_RERANK") ? JSON.stringify({ results: JSON.parse(body).candidates.map((item: { id: string }) => ({ id: item.id, score: 0, reason: "Нет ответа." })) }) : undefined);
  const refusal = await groundingResponse(request({ question: "Вопрос", settings: testSettings }), () => new GroundedRagAgent(llm, { index, embedder: testEmbedder }));
  assert.equal(refusal.status, 200);
  const unknown = (await refusal.json()).answer;
  assert.equal(unknown.status, "unknown");
  assert.deepEqual(unknown.result.sources, []);
  assert.deepEqual(unknown.quotes, []);
});

test("grounding NDJSON saves a full run and cancellation preserves the report and releases the lock", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "grounding-stream-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const index = await refinementIndex(t);
  const path = join(root, "report.json");
  const lockPath = join(root, "run.lock");
  const dependencies = {
    run: (settings: typeof testSettings, signal: AbortSignal, onCase?: Parameters<typeof runGroundingBenchmark>[0]["onCase"]) => runGroundingBenchmark({ settings, signal, onCase, index, embedder: testEmbedder, llm: groundingLlm(), questions: groundingQuestions() }),
    save: (report: Awaited<ReturnType<typeof runGroundingBenchmark>>, signal: AbortSignal) => saveGroundingBenchmark(report, path, signal),
    lock: () => acquireGroundingBenchmarkLock(lockPath),
  };
  const response = await groundingBenchmarkResponse(request({ settings: testSettings }), dependencies);
  const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(events[0].type, "start");
  assert.equal(events.filter((item) => item.type === "case").length, 12);
  assert.equal(events.at(-1).type, "complete");
  const saved = await readFile(path, "utf8");
  const cancelled = await groundingBenchmarkResponse(request({ settings: testSettings }), dependencies);
  const reader = cancelled.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes('"type":"case"')) text += decoder.decode((await reader.read()).value);
  await reader.cancel();
  assert.equal(await readFile(path, "utf8"), saved);
  await assert.rejects(readFile(lockPath), { code: "ENOENT" });
  await (await dependencies.lock())();
});

test("provider errors emit one error event, log once and preserve the previous report", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "grounding-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "report.json");
  await writeFile(path, "previous report\n");
  const logs: unknown[] = [];
  t.mock.method(console, "error", (event: unknown) => logs.push(event));
  const response = await groundingBenchmarkResponse(request({ settings: testSettings }), {
    run: async () => { throw new Error("provider unavailable"); },
    save: (report, signal) => saveGroundingBenchmark(report, path, signal),
    lock: () => acquireGroundingBenchmarkLock(join(root, "run.lock")),
  });
  const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(events.map((item) => item.type), ["start", "error"]);
  assert.equal(await readFile(path, "utf8"), "previous report\n");
  assert.equal(logs.length, 1);
});

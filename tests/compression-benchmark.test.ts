import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { parseBlindJudgeResult } from "../src/lib/blind-judge";
import type { ChatMessage } from "../src/lib/chat-agent";
import { CompressionBenchmark } from "../src/lib/compression-benchmark";
import { SqliteCompressionRunStore } from "../src/lib/compression-run-store";
import type { ChatRequestOptions } from "../src/lib/conversation-types";

const directories: string[] = [];
const encoder = new TextEncoder();
after(async () => {
  await Promise.all(directories.map((path) => rm(path, { recursive: true, force: true })));
});

async function databasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "flash-benchmark-"));
  directories.push(directory);
  return join(directory, "chat.sqlite");
}

function response(text: string, promptTokens: number, completionTokens: number) {
  return {
    stream: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(text));
        controller.close();
      },
    }),
    usage: Promise.resolve({
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      cacheHitTokens: 0,
      cacheMissTokens: promptTokens,
    }),
  };
}

const judge = JSON.stringify({
  a: { factualAccuracy: 10, completeness: 10, instructionFollowing: 10, overall: 10 },
  b: { factualAccuracy: 9, completeness: 9, instructionFollowing: 9, overall: 9 },
  winner: "a",
  rationale: "A точнее.",
});

test("runs exactly four sequential calls and persists provider-based savings", async () => {
  const path = await databasePath();
  let store = new SqliteCompressionRunStore(path);
  const calls: { messages: readonly ChatMessage[]; options?: ChatRequestOptions }[] = [];
  const outputs = [
    response("Summary", 100, 20),
    response('{"project":"Аврора"}', 500, 30),
    response('{"project":"Аврора"}', 200, 25),
    response(judge, 300, 40),
  ];
  const llm = {
    model: "deepseek-v4-flash",
    async respond(
      messages: readonly ChatMessage[],
      _signal: AbortSignal,
      options?: ChatRequestOptions,
    ) {
      calls.push({ messages, options });
      return outputs[calls.length - 1];
    },
  };
  const benchmark = new CompressionBenchmark(
    llm,
    store,
    () => 0,
    () => new Date("2026-09-14T12:00:00Z"),
  );
  const run = await benchmark.run(AbortSignal.timeout(10_000));

  assert.equal(calls.length, 4);
  assert.equal(calls[0].options?.maxOutputTokens, 512);
  assert.equal(calls[1].messages.length, 21);
  assert.equal(calls[2].messages.length, 11);
  assert.equal(calls[2].options?.systemMessages?.length, 2);
  assert.equal(calls[3].options?.maxOutputTokens, 512);
  assert.doesNotMatch(calls[3].messages[0].content, /"full"|"compressed"/);
  assert.equal(run.labelA, "full");
  assert.equal(run.grossSavedTokens, 300);
  assert.equal(run.summaryOverheadTokens, 120);
  assert.equal(run.netSavedTokens, 180);
  store.close();

  store = new SqliteCompressionRunStore(path);
  assert.deepEqual(store.getLatestRun(), run);
  store.close();
});

test("rejects malformed judge output without saving a run", async () => {
  const store = new SqliteCompressionRunStore(await databasePath());
  let calls = 0;
  const llm = {
    model: "deepseek-v4-flash",
    async respond() {
      calls += 1;
      const text = calls === 4 ? "```json\n{}\n```" : "ok";
      return response(text, 10, 2);
    },
  };
  const benchmark = new CompressionBenchmark(llm, store, () => 1);
  await assert.rejects(benchmark.run(AbortSignal.timeout(10_000)), /Judge/);
  assert.equal(calls, 4);
  assert.equal(store.getLatestRun(), null);
  store.close();
});

test("does not retry a failed provider call", async () => {
  const store = new SqliteCompressionRunStore(await databasePath());
  let calls = 0;
  const llm = {
    model: "deepseek-v4-flash",
    async respond() {
      calls += 1;
      if (calls === 2) throw new Error("provider failed");
      return response("ok", 10, 2);
    },
  };
  await assert.rejects(
    new CompressionBenchmark(llm, store).run(AbortSignal.timeout(10_000)),
    /provider failed/,
  );
  assert.equal(calls, 2);
  assert.equal(store.getLatestRun(), null);
  store.close();
});

test("strict judge parser rejects extra keys and non-integer scores", () => {
  assert.throws(() => parseBlindJudgeResult(`${judge}\ntrailing`));
  const withExtra = JSON.parse(judge);
  withExtra.extra = true;
  assert.throws(() => parseBlindJudgeResult(JSON.stringify(withExtra)));
  const decimal = JSON.parse(judge);
  decimal.a.overall = 9.5;
  assert.throws(() => parseBlindJudgeResult(JSON.stringify(decimal)));
});

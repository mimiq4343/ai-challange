import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ChatMessage } from "../src/lib/chat-agent";
import { ContextStrategyBenchmark } from "../src/lib/context-strategy-benchmark";
import { SqliteContextStrategyStore } from "../src/lib/context-strategy-store";
import type { CompressionLlmResponder } from "../src/lib/compression-llm";
import type { ChatAgentResponse, ChatRequestOptions } from "../src/lib/conversation-types";

const fullAnswer =
  "Аврора; 1 800 000 рублей; 15 ноября; web; руководители отделов; без персональных данных; PostgreSQL; тёмная тема.";
const factsJson = JSON.stringify({
  goal: "Аврора",
  constraints: ["1 800 000 рублей", "15 ноября", "без персональных данных"],
  preferences: ["тёмная тема"],
  decisions: ["web", "руководители отделов", "PostgreSQL"],
  agreements: [],
});

class ScriptedLlm implements CompressionLlmResponder {
  readonly model = "deepseek-v4-flash";
  readonly calls: Array<{ messages: readonly ChatMessage[]; options?: ChatRequestOptions }> = [];

  constructor(private readonly outputs: string[]) {}

  async respond(
    messages: readonly ChatMessage[],
    _signal: AbortSignal,
    options?: ChatRequestOptions,
  ): Promise<ChatAgentResponse> {
    this.calls.push({ messages, options });
    const text = this.outputs.shift();
    if (text === undefined) throw new Error("Неожиданный LLM-вызов.");
    return {
      stream: new Blob([text]).stream(),
      usage: Promise.resolve({
        promptTokens: 40,
        completionTokens: 10,
        totalTokens: 50,
        cacheHitTokens: null,
        cacheMissTokens: null,
      }),
    };
  }
}

test("runs one scenario for all strategies and persists comparable metrics", async () => {
  const directory = mkdtempSync(join(tmpdir(), "context-benchmark-"));
  const store = new SqliteContextStrategyStore(join(directory, "test.sqlite"));
  try {
    const llm = new ScriptedLlm([
      "web; руководители отделов; без персональных данных; PostgreSQL; тёмная тема.",
      factsJson,
      factsJson,
      factsJson,
      factsJson,
      factsJson,
      factsJson,
      fullAnswer,
      fullAnswer,
    ]);
    const run = await new ContextStrategyBenchmark(llm, store).run(
      new AbortController().signal,
    );
    assert.deepEqual(run.results.map(({ strategy }) => strategy), [
      "sliding",
      "facts",
      "branching",
    ]);
    assert.equal(run.results[0].stabilityScore, 0);
    assert.equal(run.results[1].qualityScore, 10);
    assert.equal(run.results[1].overheadTokens, 300);
    assert.equal(run.results[2].stabilityScore, 10);
    assert.equal(store.getLatestBenchmarkRun()?.id, run.id);
    assert.equal(llm.calls.length, 9);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

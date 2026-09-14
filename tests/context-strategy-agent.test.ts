import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ChatMessage } from "../src/lib/chat-agent";
import { ContextStrategyAgent } from "../src/lib/context-strategy-agent";
import { SqliteContextStrategyStore } from "../src/lib/context-strategy-store";
import type { CompressionLlmResponder } from "../src/lib/compression-llm";
import type { ChatAgentResponse, ChatRequestOptions } from "../src/lib/conversation-types";

const usage = {
  promptTokens: 40,
  completionTokens: 10,
  totalTokens: 50,
  cacheHitTokens: null,
  cacheMissTokens: null,
};

function response(text: string): ChatAgentResponse {
  return {
    stream: new Blob([text]).stream(),
    usage: Promise.resolve(usage),
  };
}

class ScriptedLlm implements CompressionLlmResponder {
  readonly model = "deepseek-v4-flash";
  readonly calls: Array<{
    messages: readonly ChatMessage[];
    options?: ChatRequestOptions;
  }> = [];

  constructor(private readonly outputs: string[]) {}

  async respond(
    messages: readonly ChatMessage[],
    _signal: AbortSignal,
    options?: ChatRequestOptions,
  ): Promise<ChatAgentResponse> {
    this.calls.push({ messages: structuredClone(messages), options });
    const output = this.outputs.shift();
    if (output === undefined) throw new Error("Неожиданный LLM-вызов.");
    return response(output);
  }
}

async function withStore(
  run: (store: SqliteContextStrategyStore) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "context-agent-"));
  const store = new SqliteContextStrategyStore(join(directory, "test.sqlite"));
  try {
    await run(store);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

const factsJson = JSON.stringify({
  goal: "Запустить приложение",
  constraints: ["Бюджет 2 млн"],
  preferences: ["Тёмная тема"],
  decisions: [],
  agreements: [],
});

test("facts are extracted before main response and sent as a system block", async () => {
  await withStore(async (store) => {
    const session = store.createSession("facts");
    const llm = new ScriptedLlm([factsJson, "Готово"]);
    const result = await new ContextStrategyAgent(store, llm).respond(
      session.id,
      "Запомни бюджет 2 млн и тёмную тему",
      new AbortController().signal,
    );
    assert.equal(await new Response(result.stream).text(), "Готово");
    assert.equal(llm.calls.length, 2);
    assert.match(llm.calls[1].options?.systemMessages?.[1] ?? "", /Бюджет 2 млн/);
    assert.equal(store.getDetail(session.id).session.facts?.goal, "Запустить приложение");
  });
});

test("branch prompt excludes messages from the sibling branch", async () => {
  await withStore(async (store) => {
    const session = store.createSession("branching");
    const baseMetrics = {
      preflight: {
        systemTokens: 1,
        historyTokens: 1,
        requestTokens: 1,
        promptTokens: 3,
        reservedOutputTokens: 10,
        contextTokens: 13,
        contextLimit: 1_000,
      },
      providerUsage: usage,
      completionTokens: 10,
      costMicrosUsd: 1,
    };
    store.saveExchange(session.id, "общий", "база", baseMetrics);
    const { branches } = store.createCheckpoint(session.id);
    store.saveExchange(session.id, "секрет A", "ответ A", baseMetrics);
    store.activateBranch(session.id, branches[1].id);
    store.saveExchange(session.id, "секрет B", "ответ B", baseMetrics);

    const llm = new ScriptedLlm(["ветка B"]);
    const result = await new ContextStrategyAgent(store, llm).respond(
      session.id,
      "Продолжай",
      new AbortController().signal,
    );
    await new Response(result.stream).text();
    const sent = llm.calls[0].messages.map(({ content }) => content).join("\n");
    assert.match(sent, /секрет B/);
    assert.doesNotMatch(sent, /секрет A/);
  });
});

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ContextLimitError,
  assertContextFits,
  buildOverflowInput,
  countChatPrompt,
  countTextTokens,
} from "../src/lib/token-counter";

test("uses the checked-in DeepSeek tokenizer and chat template", async () => {
  assert.equal(await countTextTokens("Привет"), 2);
  assert.deepEqual(await countChatPrompt({ history: [], request: "Привет" }), {
    systemTokens: 54,
    historyTokens: 0,
    requestTokens: 4,
    promptTokens: 58,
    reservedOutputTokens: 4_096,
    contextTokens: 4_154,
    contextLimit: 1_000_000,
  });
});

test("splits history and request through monotonic chat-template prefixes", async () => {
  const breakdown = await countChatPrompt({
    history: [
      { role: "user", content: "Запомни КЕДР" },
      { role: "assistant", content: "Запомнил" },
    ],
    request: "Какое слово?",
  });

  assert.ok(breakdown.historyTokens > 0);
  assert.ok(breakdown.requestTokens > 0);
  assert.equal(
    breakdown.promptTokens,
    breakdown.systemTokens + breakdown.historyTokens + breakdown.requestTokens,
  );
});

test("accepts limit - 1 and limit but rejects limit + 1", () => {
  const base = {
    systemTokens: 1,
    historyTokens: 1,
    requestTokens: 1,
    promptTokens: 3,
    reservedOutputTokens: 1,
    contextLimit: 1_000_000,
  };

  assert.doesNotThrow(() => assertContextFits({ ...base, contextTokens: 999_999 }));
  assert.doesNotThrow(() => assertContextFits({ ...base, contextTokens: 1_000_000 }));
  assert.throws(
    () => assertContextFits({ ...base, contextTokens: 1_000_001 }),
    ContextLimitError,
  );
});

test(
  "builds a deterministic Nemotron input above its configured context window",
  { timeout: 30_000 },
  async () => {
    const overflow = await buildOverflowInput();
    assert.equal(overflow.tokens, 33_288);
    assert.ok(overflow.tokens > 32_768);
    assert.ok(overflow.tokens <= 33_344);
  },
);

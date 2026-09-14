import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseStickyFacts, WINDOW_MESSAGES } from "../src/lib/context-strategy-policy";
import { SqliteContextStrategyStore } from "../src/lib/context-strategy-store";
import type { ContextExchangeMetrics } from "../src/lib/context-strategy-types";

const metrics: ContextExchangeMetrics = {
  preflight: {
    systemTokens: 10,
    historyTokens: 20,
    requestTokens: 5,
    promptTokens: 35,
    reservedOutputTokens: 100,
    contextTokens: 135,
    contextLimit: 1_000,
  },
  providerUsage: {
    promptTokens: 36,
    completionTokens: 4,
    totalTokens: 40,
    cacheHitTokens: null,
    cacheMissTokens: null,
  },
  completionTokens: 4,
  costMicrosUsd: 2,
};

function withStore(run: (store: SqliteContextStrategyStore) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "context-strategy-"));
  const store = new SqliteContextStrategyStore(join(directory, "test.sqlite"));
  try {
    run(store);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("sliding physically retains only the last six messages", () => {
  withStore((store) => {
    const session = store.createSession("sliding");
    for (let index = 1; index <= 4; index += 1) {
      store.saveExchange(session.id, `user-${index}`, `assistant-${index}`, metrics);
    }
    const detail = store.getDetail(session.id);
    assert.equal(detail.messages.length, WINDOW_MESSAGES);
    assert.deepEqual(
      detail.messages.map(({ content }) => content),
      ["user-2", "assistant-2", "user-3", "assistant-3", "user-4", "assistant-4"],
    );
  });
});

test("branch continuations share the checkpoint and exclude sibling messages", () => {
  withStore((store) => {
    const session = store.createSession("branching");
    store.saveExchange(session.id, "общий вопрос", "общий ответ", metrics);
    const { branches } = store.createCheckpoint(session.id);
    store.saveExchange(session.id, "только A", "ответ A", metrics);

    store.activateBranch(session.id, branches[1].id);
    store.saveExchange(session.id, "только B", "ответ B", metrics);
    assert.deepEqual(
      store.getVisibleMessages(session.id).map(({ content }) => content),
      ["общий вопрос", "общий ответ", "только B", "ответ B"],
    );

    store.activateBranch(session.id, branches[0].id);
    assert.deepEqual(
      store.getVisibleMessages(session.id).map(({ content }) => content),
      ["общий вопрос", "общий ответ", "только A", "ответ A"],
    );
  });
});

test("facts parser accepts exact schema and rejects extra keys", () => {
  const valid = JSON.stringify({
    goal: "Запустить продукт",
    constraints: ["Бюджет 2 млн"],
    preferences: [],
    decisions: [],
    agreements: [],
  });
  assert.equal(parseStickyFacts(valid).goal, "Запустить продукт");
  assert.throws(() => parseStickyFacts(valid.slice(0, -1) + ',"extra":true}'));
});

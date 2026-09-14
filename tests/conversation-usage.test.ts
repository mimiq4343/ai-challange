import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { SqliteConversationStore } from "../src/lib/conversation-store";
import type { ExchangeUsageInput } from "../src/lib/conversation-types";
import { getConversationAnalytics } from "../src/lib/token-analytics";

const temporaryDirectories: string[] = [];

after(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createStore(): Promise<SqliteConversationStore> {
  const directory = await mkdtemp(join(tmpdir(), "flash-usage-"));
  temporaryDirectories.push(directory);
  return new SqliteConversationStore(join(directory, "chat.sqlite"));
}

const usage: ExchangeUsageInput = {
  model: "deepseek-v4-flash",
  contextLimit: 1_000_000,
  systemTokens: 54,
  historyTokens: 0,
  requestTokens: 10,
  promptTokens: 64,
  reservedOutputTokens: 4_096,
  contextTokens: 4_160,
  responseTokens: 5,
  providerUsage: {
    promptTokens: 66,
    completionTokens: 5,
    totalTokens: 71,
    cacheHitTokens: 40,
    cacheMissTokens: 26,
  },
  source: "provider",
  tariffBand: "off-peak",
  costMicrosUsd: 7,
};

test("persists a completed exchange and usage atomically", async () => {
  const store = await createStore();
  const conversation = store.createConversation();
  store.saveExchange(conversation.id, "Вопрос", "Ответ", usage);

  assert.equal(store.getMessages(conversation.id).length, 2);
  assert.deepEqual(store.getConversationUsage(conversation.id), [
    {
      id: 1,
      conversationId: conversation.id,
      assistantMessageId: 2,
      model: "deepseek-v4-flash",
      contextLimit: 1_000_000,
      systemTokens: 54,
      historyTokens: 0,
      requestTokens: 10,
      promptTokens: 64,
      reservedOutputTokens: 4_096,
      contextTokens: 4_160,
      responseTokens: 5,
      providerPromptTokens: 66,
      providerCompletionTokens: 5,
      cacheHitTokens: 40,
      cacheMissTokens: 26,
      source: "provider",
      tariffBand: "off-peak",
      costMicrosUsd: 7,
      createdAt: store.getMessages(conversation.id)[1].createdAt,
    },
  ]);
  store.close();
});

test("rolls back both messages when usage violates a constraint", async () => {
  const store = await createStore();
  const conversation = store.createConversation();
  assert.throws(() =>
    store.saveExchange(conversation.id, "Вопрос", "Ответ", {
      ...usage,
      costMicrosUsd: -1,
    }),
  );
  assert.deepEqual(store.getMessages(conversation.id), []);
  assert.deepEqual(store.getConversationUsage(conversation.id), []);
  store.close();
});

test("cascades usage deletion with its conversation", async () => {
  const store = await createStore();
  const conversation = store.createConversation();
  store.saveExchange(conversation.id, "Вопрос", "Ответ", usage);
  assert.equal(store.deleteConversation(conversation.id), true);
  assert.deepEqual(store.getConversationUsage(conversation.id), []);
  store.close();
});

test("derives estimates for legacy exchanges without mutating them", async () => {
  const store = await createStore();
  const conversation = store.createConversation();
  store.saveExchange(conversation.id, "Старый вопрос", "Старый ответ");

  const analytics = await getConversationAnalytics(store, conversation.id);
  assert.equal(analytics.exchanges.length, 1);
  assert.equal(analytics.exchanges[0].source, "estimated");
  assert.ok(analytics.exchanges[0].promptTokens > 0);
  assert.deepEqual(store.getConversationUsage(conversation.id), []);
  store.close();
});

test("stores only compact overflow metadata and bounds provider errors", async () => {
  const store = await createStore();
  const run = store.saveOverflowRun({
    model: "nvidia/nemotron-3-embed-1b:free",
    contextLimit: 32_768,
    localInputTokens: 33_288,
    providerInputTokens: null,
    outcome: "rejected",
    httpStatus: 400,
    errorMessage: "x".repeat(700),
    durationMs: 120,
    costMicrosUsd: 0,
  });

  assert.equal(run.errorMessage?.length, 500);
  assert.deepEqual(store.getLatestOverflowRun(), run);
  assert.equal("input" in run, false);
  assert.equal("embedding" in run, false);
  store.close();
});

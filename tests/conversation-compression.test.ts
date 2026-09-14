import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { SqliteConversationStore } from "../src/lib/conversation-store";
import type { ExchangeUsageInput } from "../src/lib/conversation-types";

const directories: string[] = [];
after(async () => {
  await Promise.all(directories.map((path) => rm(path, { recursive: true, force: true })));
});

async function databasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "flash-compression-"));
  directories.push(directory);
  return join(directory, "chat.sqlite");
}

const usage: ExchangeUsageInput = {
  model: "deepseek-v4-flash",
  contextLimit: 1_000_000,
  systemTokens: 60,
  historyTokens: 100,
  requestTokens: 10,
  promptTokens: 170,
  reservedOutputTokens: 4_096,
  contextTokens: 4_266,
  responseTokens: 12,
  providerUsage: {
    promptTokens: 172,
    completionTokens: 12,
    totalTokens: 184,
    cacheHitTokens: 100,
    cacheMissTokens: 72,
  },
  source: "provider",
  tariffBand: "off-peak",
  costMicrosUsd: 8,
};

test("persists immutable checkpoints and atomic exchange compression", async () => {
  const path = await databasePath();
  let store = new SqliteConversationStore(path);
  const conversation = store.createConversation();
  for (let index = 0; index < 10; index += 1) {
    store.saveExchange(conversation.id, `u${index}`, `a${index}`);
  }
  const checkpoint = store.saveConversationSummary(conversation.id, {
    summarizedThroughMessageId: 10,
    summarizedMessageCount: 10,
    content: "Сохранённые факты",
    model: "deepseek-v4-flash",
    providerPromptTokens: 120,
    providerCompletionTokens: 30,
    costMicrosUsd: 5,
  });
  store.saveExchange(conversation.id, "новый вопрос", "новый ответ", usage, {
    summaryId: checkpoint.id,
    rawTailMessageCount: 10,
    fullPromptTokens: 300,
    compressedPromptTokens: 170,
    summaryTokens: 40,
    rawTailTokens: 100,
    grossSavedTokens: 130,
  });
  assert.equal(store.getConversationCompression(conversation.id)[0].providerPromptTokens, 172);
  store.close();

  store = new SqliteConversationStore(path);
  assert.equal(store.getLatestConversationSummary(conversation.id)?.content, "Сохранённые факты");
  assert.equal(store.getMessages(conversation.id).length, 22);
  assert.equal(store.getConversationCompression(conversation.id).length, 1);
  assert.throws(() =>
    store.saveExchange(conversation.id, "bad", "bad", usage, {
      summaryId: checkpoint.id,
      rawTailMessageCount: 20,
      fullPromptTokens: 1,
      compressedPromptTokens: 1,
      summaryTokens: 0,
      rawTailTokens: 0,
      grossSavedTokens: 0,
    }),
  );
  assert.equal(store.getMessages(conversation.id).length, 22);
  assert.equal(store.deleteConversation(conversation.id), true);
  assert.deepEqual(store.getConversationSummaries(conversation.id), []);
  assert.deepEqual(store.getConversationCompression(conversation.id), []);
  store.close();
});

test("rejects skipped checkpoint cursors and missing provider usage", async () => {
  const store = new SqliteConversationStore(await databasePath());
  const conversation = store.createConversation();
  for (let index = 0; index < 10; index += 1) {
    store.saveExchange(conversation.id, `u${index}`, `a${index}`);
  }
  assert.throws(() =>
    store.saveConversationSummary(conversation.id, {
      summarizedThroughMessageId: 12,
      summarizedMessageCount: 10,
      content: "bad",
      model: "deepseek-v4-flash",
      providerPromptTokens: 1,
      providerCompletionTokens: 1,
      costMicrosUsd: 1,
    }),
  );
  assert.throws(() =>
    store.saveConversationSummary(conversation.id, {
      summarizedThroughMessageId: 10,
      summarizedMessageCount: 10,
      content: "bad",
      model: "deepseek-v4-flash",
      providerPromptTokens: null,
      providerCompletionTokens: null,
      costMicrosUsd: 0,
    }),
  );
  store.close();
});

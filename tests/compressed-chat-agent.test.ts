import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { ChatAgentError, type ChatMessage } from "../src/lib/chat-agent";
import { CompressedChatAgent } from "../src/lib/compressed-chat-agent";
import { SqliteConversationStore } from "../src/lib/conversation-store";
import type { ChatRequestOptions } from "../src/lib/conversation-types";
import { HistorySummarizer } from "../src/lib/history-summarizer";

const directories: string[] = [];
const encoder = new TextEncoder();
after(async () => {
  await Promise.all(directories.map((path) => rm(path, { recursive: true, force: true })));
});

async function storeWithExchanges(count: number): Promise<{
  store: SqliteConversationStore;
  conversationId: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "flash-compressed-agent-"));
  directories.push(directory);
  const store = new SqliteConversationStore(join(directory, "chat.sqlite"));
  const conversation = store.createConversation();
  for (let index = 0; index < count; index += 1) {
    store.saveExchange(conversation.id, `u${index}`, `a${index}`);
  }
  return { store, conversationId: conversation.id };
}

function successfulResponse(text: string, promptTokens = 100) {
  return {
    stream: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(text));
        controller.close();
      },
    }),
    usage: Promise.resolve({
      promptTokens,
      completionTokens: 5,
      totalTokens: promptTokens + 5,
      cacheHitTokens: 0,
      cacheMissTokens: promptTokens,
    }),
  };
}

test("summarizes the first ten messages and sends only summary plus raw tail", async () => {
  const { store, conversationId } = await storeWithExchanges(10);
  const calls: { messages: readonly ChatMessage[]; options?: ChatRequestOptions }[] = [];
  const llm = {
    model: "deepseek-v4-flash",
    async respond(
      messages: readonly ChatMessage[],
      _signal: AbortSignal,
      options?: ChatRequestOptions,
    ) {
      calls.push({ messages, options });
      return successfulResponse(calls.length === 1 ? "Факты первых сообщений" : "Ответ");
    },
  };
  const summarizer = new HistorySummarizer(store, llm, () => new Date("2026-09-14T12:00:00Z"));
  const agent = new CompressedChatAgent(store, llm, summarizer, () => new Date("2026-09-14T12:00:00Z"));
  const response = await agent.respond(conversationId, "Новый вопрос", AbortSignal.timeout(5_000));
  assert.equal(await new Response(response.stream).text(), "Ответ");

  assert.equal(calls.length, 2);
  assert.equal(calls[0].options?.maxOutputTokens, 512);
  assert.equal(calls[1].options?.systemMessages?.length, 2);
  assert.deepEqual(calls[1].messages.slice(0, 2), [
    { role: "user", content: "u5" },
    { role: "assistant", content: "a5" },
  ]);
  assert.equal(calls[1].messages.length, 11);
  assert.equal(store.getLatestConversationSummary(conversationId)?.summarizedMessageCount, 10);
  assert.equal(store.getMessages(conversationId).length, 22);
  assert.equal(store.getConversationCompression(conversationId).length, 1);
  store.close();
});

test("keeps a completed checkpoint when the next summary fails and never calls main", async () => {
  const { store, conversationId } = await storeWithExchanges(15);
  let calls = 0;
  const llm = {
    model: "deepseek-v4-flash",
    async respond() {
      calls += 1;
      if (calls === 2) throw new ChatAgentError("summary failed", "upstream");
      return successfulResponse("Первый checkpoint");
    },
  };
  const agent = new CompressedChatAgent(store, llm);
  await assert.rejects(
    agent.respond(conversationId, "request", AbortSignal.timeout(5_000)),
    /summary failed/,
  );
  assert.equal(calls, 2);
  assert.equal(store.getLatestConversationSummary(conversationId)?.summarizedMessageCount, 10);
  assert.equal(store.getMessages(conversationId).length, 30);
  assert.deepEqual(store.getConversationCompression(conversationId), []);
  store.close();
});

test("does not persist a failed main stream but keeps its summary", async () => {
  const { store, conversationId } = await storeWithExchanges(10);
  let calls = 0;
  const llm = {
    model: "deepseek-v4-flash",
    async respond() {
      calls += 1;
      if (calls === 1) return successfulResponse("Summary");
      return {
        stream: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(new Error("main stream failed"));
          },
        }),
        usage: Promise.resolve(null),
      };
    },
  };
  const agent = new CompressedChatAgent(store, llm);
  const response = await agent.respond(conversationId, "request", AbortSignal.timeout(5_000));
  await assert.rejects(new Response(response.stream).text(), /main stream failed/);
  assert.equal(store.getMessages(conversationId).length, 20);
  assert.equal(store.getConversationSummaries(conversationId).length, 1);
  assert.deepEqual(store.getConversationCompression(conversationId), []);
  store.close();
});

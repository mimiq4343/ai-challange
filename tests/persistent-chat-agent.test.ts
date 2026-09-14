import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { ChatMessage } from "../src/lib/chat-agent";
import { SqliteConversationStore } from "../src/lib/conversation-store";
import { PersistentChatAgent } from "../src/lib/persistent-chat-agent";

const temporaryDirectories: string[] = [];
const encoder = new TextEncoder();

after(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

test("loads saved context before the LLM call and persists the completed exchange", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flash-agent-"));
  temporaryDirectories.push(directory);
  const store = new SqliteConversationStore(join(directory, "chat.sqlite"));
  const conversation = store.createConversation();
  store.saveExchange(conversation.id, "Меня зовут Роман", "Приятно познакомиться, Роман");

  const calls: ChatMessage[][] = [];
  const llm = {
    model: "deepseek-v4-flash",
    async respond(messages: ChatMessage[]) {
      calls.push(messages);
      return {
        stream: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode("КЕ"));
            controller.enqueue(encoder.encode("ДР"));
            controller.close();
          },
        }),
        usage: Promise.resolve({
          promptTokens: 100,
          completionTokens: 2,
          totalTokens: 102,
          cacheHitTokens: 50,
          cacheMissTokens: 50,
        }),
      };
    },
  };
  const agent = new PersistentChatAgent(store, llm);

  const response = await agent.respond(
    conversation.id,
    "Какое кодовое слово?",
    AbortSignal.timeout(1_000),
  );
  assert.equal(await new Response(response.stream).text(), "КЕДР");
  assert.deepEqual(calls, [
    [
      { role: "user", content: "Меня зовут Роман" },
      { role: "assistant", content: "Приятно познакомиться, Роман" },
      { role: "user", content: "Какое кодовое слово?" },
    ],
  ]);
  assert.deepEqual(
    store.getMessages(conversation.id).map(({ role, content }) => ({ role, content })),
    [
      { role: "user", content: "Меня зовут Роман" },
      { role: "assistant", content: "Приятно познакомиться, Роман" },
      { role: "user", content: "Какое кодовое слово?" },
      { role: "assistant", content: "КЕДР" },
    ],
  );
  store.close();
});

test("does not persist an exchange when the LLM stream fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flash-agent-"));
  temporaryDirectories.push(directory);
  const store = new SqliteConversationStore(join(directory, "chat.sqlite"));
  const conversation = store.createConversation();
  const llm = {
    model: "deepseek-v4-flash",
    async respond() {
      return {
        stream: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode("частичный ответ"));
            controller.error(new Error("stream failed"));
          },
        }),
        usage: Promise.resolve(null),
      };
    },
  };
  const agent = new PersistentChatAgent(store, llm);

  const response = await agent.respond(conversation.id, "Запрос", AbortSignal.timeout(1_000));
  await assert.rejects(new Response(response.stream).text(), /stream failed/);
  assert.deepEqual(store.getMessages(conversation.id), []);
  store.close();
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import type { ChatMessage } from "../src/lib/chat-agent";
import { SqliteConversationStore } from "../src/lib/conversation-store";
import type { ChatRequestOptions } from "../src/lib/conversation-types";
import { MemoryChatAgent } from "../src/lib/memory-chat-agent";
import type { MemoryRouterLlm } from "../src/lib/memory-router-llm";
import { SqliteMemoryStore } from "../src/lib/memory-store";
import { SqliteProfileStore } from "../src/lib/profile-store";
import type { MemoryLayerToggles } from "../src/lib/memory-types";

const temporaryDirectories: string[] = [];
const encoder = new TextEncoder();
const ALL_LAYERS: MemoryLayerToggles = {
  shortTerm: true,
  working: true,
  longTerm: true,
  profile: false,
  task: false,
};

after(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

type RecordedCall = {
  messages: readonly ChatMessage[];
  options?: ChatRequestOptions;
};

function stubLlm(text: string, calls: RecordedCall[]) {
  return {
    model: "deepseek-v4-flash",
    async respond(
      messages: readonly ChatMessage[],
      _signal: AbortSignal,
      options?: ChatRequestOptions,
    ) {
      calls.push({ messages, options });
      return {
        stream: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(text));
            controller.close();
          },
        }),
        usage: Promise.resolve({
          promptTokens: 120,
          completionTokens: 8,
          totalTokens: 128,
          cacheHitTokens: 0,
          cacheMissTokens: 120,
        }),
      };
    },
  };
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function createEnvironment() {
  const directory = await mkdtemp(join(tmpdir(), "flash-memory-agent-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "chat.sqlite");
  const store = new SqliteConversationStore(databasePath);
  const memory = new SqliteMemoryStore(databasePath);
  const profiles = new SqliteProfileStore(databasePath);
  return { store, memory, profiles, profileId: profiles.getActiveProfile().id };
}

test("router writes land in their layers and the prompt carries every enabled block", async () => {
  const { store, memory, profiles, profileId } = await createEnvironment();
  const conversation = store.createConversation();
  memory.upsertLongTerm({
    profileId,
    kind: "profile",
    key: "favourite_color",
    value: "синий",
    origin: "user",
    reason: null,
    sourceConversationId: null,
  });
  memory.upsertActiveTask(conversation.id, { title: "Модель памяти", goal: "Разделить слои" });

  const calls: RecordedCall[] = [];
  const router: MemoryRouterLlm = {
    model: "deepseek-v4-flash",
    async complete() {
      return {
        content: `{"task": null, "closeTask": false, "writes": [
          {"layer": "long_term", "kind": "profile", "key": "language", "value": "TypeScript", "reason": "назвал язык"},
          {"layer": "working", "kind": "step", "value": "Собрать инспектор", "reason": null}
        ]}`,
        usage: {
          promptTokens: 300,
          completionTokens: 60,
          totalTokens: 360,
          cacheHitTokens: 0,
          cacheMissTokens: 300,
        },
      };
    },
  };

  const agent = new MemoryChatAgent(
    store,
    memory,
    profiles,
    stubLlm("Готово", calls),
    router,
  );
  const response = await agent.respond(
    conversation.id,
    "Я пишу на TypeScript",
    ALL_LAYERS,
    new AbortController().signal,
  );
  assert.equal(await drain(response.stream), "Готово");

  const systemMessages = calls[0].options?.systemMessages ?? [];
  assert.equal(systemMessages.length, 3);
  assert.match(systemMessages[1], /favourite_color: синий/);
  assert.match(systemMessages[2], /Задача: Модель памяти/);

  assert.deepEqual(
    memory.listLongTerm(profileId).map((entry) => entry.key).sort(),
    ["favourite_color", "language"],
  );
  assert.deepEqual(
    memory.getWorkingMemory(conversation.id)?.slots.map((slot) => slot.value),
    ["Собрать инспектор"],
  );

  const usage = memory.getLatestUsage(conversation.id);
  assert.ok((usage?.longTermTokens ?? 0) > 0);
  assert.ok((usage?.workingTokens ?? 0) > 0);
  assert.equal(usage?.router?.completionTokens, 60);
  assert.deepEqual(usage?.layers, ALL_LAYERS);

  memory.close();
  profiles.close();
  store.close();
});

test("disabled layers stay out of the prompt", async () => {
  const { store, memory, profiles, profileId } = await createEnvironment();
  const conversation = store.createConversation();
  store.saveExchange(conversation.id, "Первый вопрос", "Первый ответ");
  memory.upsertLongTerm({
    profileId,
    kind: "profile",
    key: "favourite_color",
    value: "синий",
    origin: "user",
    reason: null,
    sourceConversationId: null,
  });

  const calls: RecordedCall[] = [];
  const agent = new MemoryChatAgent(store, memory, profiles, stubLlm("Ответ", calls), null);
  await drain(
    (
      await agent.respond(
        conversation.id,
        "Какой у меня цвет?",
        { shortTerm: false, working: false, longTerm: false, profile: false, task: false },
        new AbortController().signal,
      )
    ).stream,
  );

  assert.deepEqual(calls[0].messages, [{ role: "user", content: "Какой у меня цвет?" }]);
  assert.equal(calls[0].options?.systemMessages?.length, 1);
  const usage = memory.getLatestUsage(conversation.id);
  assert.equal(usage?.longTermTokens, 0);
  assert.equal(usage?.shortTermTokens, 0);
  assert.deepEqual(usage?.layers, {
    shortTerm: false,
    working: false,
    longTerm: false,
    profile: false,
    task: false,
  });

  memory.close();
  profiles.close();
  store.close();
});

test("a failing router keeps the exchange and leaves memory unchanged", async () => {
  const { store, memory, profiles, profileId } = await createEnvironment();
  const conversation = store.createConversation();

  const failingRouter: MemoryRouterLlm = {
    model: "deepseek-v4-flash",
    async complete() {
      throw new Error("роутер недоступен");
    },
  };
  const agent = new MemoryChatAgent(
    store,
    memory,
    profiles,
    stubLlm("Ответ агента", []),
    failingRouter,
  );

  const response = await agent.respond(
    conversation.id,
    "Вопрос",
    ALL_LAYERS,
    new AbortController().signal,
  );
  assert.equal(await drain(response.stream), "Ответ агента");

  assert.deepEqual(
    store.getMessages(conversation.id).map(({ role, content }) => ({ role, content })),
    [
      { role: "user", content: "Вопрос" },
      { role: "assistant", content: "Ответ агента" },
    ],
  );
  assert.equal(memory.listLongTerm(profileId).length, 0);
  assert.equal(memory.getWorkingMemory(conversation.id), null);
  assert.equal(memory.listWrites(conversation.id).length, 0);
  assert.ok(memory.getLatestUsage(conversation.id) !== null);
  assert.equal(memory.getLatestUsage(conversation.id)?.router, null);

  memory.close();
  profiles.close();
  store.close();
});

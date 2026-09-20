import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { CHAT_SYSTEM_PROMPT, type ChatMessage } from "../src/lib/chat-agent";
import {
  ConversationNotFoundError,
  MemoryValidationError,
  SqliteConversationStore,
} from "../src/lib/conversation-store";
import type { LongTermMemoryCategory } from "../src/lib/conversation-types";
import { buildSystemPrompt, getMemorySnapshot, renderMemoryContext } from "../src/lib/memory";
import { PersistentChatAgent } from "../src/lib/persistent-chat-agent";
import { countChatPrompt } from "../src/lib/token-counter";

const temporaryDirectories: string[] = [];
const encoder = new TextEncoder();

after(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createStore(): Promise<SqliteConversationStore> {
  const directory = await mkdtemp(join(tmpdir(), "flash-memory-"));
  temporaryDirectories.push(directory);
  return new SqliteConversationStore(join(directory, "chat.sqlite"));
}

test("keeps memory layers separate and scopes working memory by conversation", async () => {
  const store = await createStore();
  const first = store.createConversation();
  const second = store.createConversation();

  store.addLongTermMemory("knowledge", "В проекте используется SQLite");
  store.addLongTermMemory("profile", "Меня зовут Роман");
  const firstNote = store.addWorkingMemory(first.id, "  Цель: демо в пятницу  ");
  store.addWorkingMemory(first.id, "Ограничение: без новых зависимостей");
  store.addWorkingMemory(second.id, "Заметка другого диалога");

  assert.equal(firstNote.content, "Цель: демо в пятницу");
  assert.deepEqual(
    store.listLongTermMemory().map((entry) => entry.category),
    ["knowledge", "profile"],
  );
  assert.deepEqual(
    store.listWorkingMemory(first.id).map((entry) => entry.content),
    ["Цель: демо в пятницу", "Ограничение: без новых зависимостей"],
  );
  assert.deepEqual(store.listWorkingMemory(second.id).map((entry) => entry.content), [
    "Заметка другого диалога",
  ]);

  store.deleteConversation(first.id);
  assert.deepEqual(store.listWorkingMemory(first.id), []);
  assert.equal(store.listWorkingMemory(second.id).length, 1);
  assert.equal(store.listLongTermMemory().length, 2);

  assert.equal(store.deleteLongTermMemory(store.listLongTermMemory()[0].id), true);
  assert.equal(store.listLongTermMemory().length, 1);
  store.close();
});

test("validates category, content and layer capacity", async () => {
  const store = await createStore();
  const conversation = store.createConversation();

  assert.throws(
    () => store.addLongTermMemory("idea" as LongTermMemoryCategory, "текст"),
    MemoryValidationError,
  );
  assert.throws(
    () => store.addLongTermMemory("profile", "   "),
    MemoryValidationError,
  );
  assert.throws(
    () => store.addWorkingMemory(conversation.id, "x".repeat(501)),
    MemoryValidationError,
  );
  assert.throws(
    () => store.addWorkingMemory("missing-conversation", "текст"),
    ConversationNotFoundError,
  );

  for (let index = 0; index < 20; index += 1) {
    store.addWorkingMemory(conversation.id, `заметка ${index}`);
  }
  assert.throws(
    () => store.addWorkingMemory(conversation.id, "лишняя"),
    /максимум 20 записей/,
  );
  store.close();
});

test("renders memory context grouped by category and folds it into the system prompt", async () => {
  const store = await createStore();
  const conversation = store.createConversation();

  assert.equal(renderMemoryContext([], []), null);

  store.addLongTermMemory("knowledge", "Стек: Next.js и SQLite");
  store.addLongTermMemory("profile", "Пользователь — Роман");
  store.addWorkingMemory(conversation.id, "Сейчас идёт Day 11");

  const longTerm = store.listLongTermMemory();
  const working = store.listWorkingMemory(conversation.id);
  const context = renderMemoryContext(longTerm, working);

  assert.ok(context);
  assert.ok(context.indexOf("[профиль] Пользователь — Роман") < context.indexOf("[знание]"));
  assert.ok(context.includes("## Рабочая память текущей задачи"));
  assert.ok(context.includes("Сейчас идёт Day 11"));

  assert.equal(buildSystemPrompt(CHAT_SYSTEM_PROMPT, [], []), CHAT_SYSTEM_PROMPT);
  const prompt = buildSystemPrompt(CHAT_SYSTEM_PROMPT, longTerm, working);
  assert.ok(prompt.startsWith(CHAT_SYSTEM_PROMPT));
  assert.ok(prompt.includes(context));
  store.close();
});

test("agent injects memory into the system prompt of the matching conversation only", async () => {
  const store = await createStore();
  const first = store.createConversation();
  const second = store.createConversation();
  store.addLongTermMemory("profile", "Пользователь — Роман");
  store.addWorkingMemory(first.id, "Цель: демо в пятницу");
  store.addWorkingMemory(second.id, "Чужая заметка другого диалога");

  const systemPrompts: string[] = [];
  const llm = {
    model: "deepseek-v4-flash",
    async respond(
      _messages: ChatMessage[],
      _signal: AbortSignal,
      options?: { systemPrompt?: string },
    ) {
      systemPrompts.push(options?.systemPrompt ?? "");
      return {
        stream: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode("готово"));
            controller.close();
          },
        }),
        usage: Promise.resolve(null),
      };
    },
  };
  const agent = new PersistentChatAgent(store, llm);

  const response = await agent.respond(first.id, "Привет", AbortSignal.timeout(1_000));
  await new Response(response.stream).text();

  assert.equal(systemPrompts.length, 1);
  assert.ok(systemPrompts[0].startsWith(CHAT_SYSTEM_PROMPT));
  assert.ok(systemPrompts[0].includes("Пользователь — Роман"));
  assert.ok(systemPrompts[0].includes("Цель: демо в пятницу"));
  assert.ok(!systemPrompts[0].includes("Чужая заметка другого диалога"));

  const baseline = await countChatPrompt({ history: [], request: "Привет" });
  assert.ok(response.preflight.systemTokens > baseline.systemTokens);
  const usage = store.getConversationUsage(first.id);
  assert.equal(usage.at(-1)?.systemTokens, response.preflight.systemTokens);
  store.close();
});

test("snapshot reports per-layer contents, token estimates and injected text", async () => {
  const store = await createStore();
  const conversation = store.createConversation();
  store.saveExchange(conversation.id, "Первый вопрос", "Первый ответ");
  store.addLongTermMemory("decision", "Решение: один агент");
  store.addWorkingMemory(conversation.id, "Рабочая заметка");

  const snapshot = await getMemorySnapshot(store, conversation.id);
  assert.equal(snapshot.conversationId, conversation.id);
  assert.equal(snapshot.shortTerm.messageCount, 2);
  assert.ok(snapshot.shortTerm.tokens > 0);
  assert.equal(snapshot.working.length, 1);
  assert.ok(snapshot.working[0].tokens > 0);
  assert.equal(snapshot.longTerm.length, 1);
  assert.ok(snapshot.longTerm[0].tokens > 0);
  assert.equal(
    snapshot.systemContext,
    renderMemoryContext(store.listLongTermMemory(), store.listWorkingMemory(conversation.id)),
  );
  assert.ok(snapshot.memoryContextTokens > 0);

  const anonymous = await getMemorySnapshot(store, null);
  assert.equal(anonymous.conversationId, null);
  assert.equal(anonymous.shortTerm.messageCount, 0);
  assert.equal(anonymous.working.length, 0);
  assert.equal(anonymous.longTerm.length, 1);

  await assert.rejects(getMemorySnapshot(store, "missing-conversation"), ConversationNotFoundError);
  store.close();
});

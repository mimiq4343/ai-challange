import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import type { ChatMessage } from "../src/lib/chat-agent";
import { SqliteConversationStore } from "../src/lib/conversation-store";
import type { ChatRequestOptions } from "../src/lib/conversation-types";
import type { MemoryRouterLlm } from "../src/lib/memory-router-llm";
import { SqliteMemoryStore } from "../src/lib/memory-store";
import { ALL_MEMORY_LAYERS_ENABLED } from "../src/lib/memory-types";
import { PersonalizedChatAgent } from "../src/lib/personalized-chat-agent";
import { SqliteInvariantStore } from "../src/lib/invariant-store";
import { SqliteProfileStore } from "../src/lib/profile-store";
import { SqliteTaskStore } from "../src/lib/task-store";

const temporaryDirectories: string[] = [];
const encoder = new TextEncoder();

after(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

type RecordedCall = { messages: readonly ChatMessage[]; options?: ChatRequestOptions };

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
        usage: Promise.resolve(null),
      };
    },
  };
}

function stubRouter(content: string): MemoryRouterLlm {
  return {
    model: "deepseek-v4-flash",
    async complete() {
      return { content, usage: null };
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
  const directory = await mkdtemp(join(tmpdir(), "flash-personalized-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "chat.sqlite");
  const store = new SqliteConversationStore(databasePath);
  const memory = new SqliteMemoryStore(databasePath);
  const profiles = new SqliteProfileStore(databasePath);
  const tasks = new SqliteTaskStore(databasePath);
  const invariants = new SqliteInvariantStore(databasePath);
  return { store, memory, profiles, tasks, invariants };
}

test("active profile becomes the first system block of the prompt", async () => {
  const { store, memory, profiles, tasks, invariants } = await createEnvironment();
  const conversation = store.createConversation();
  const engineer = profiles.activateProfile(
    profiles.createProfile({
      name: "Инженер",
      role: "backend-инженер",
      tone: "direct",
      verbosity: "brief",
      format: "code_first",
      expertise: "expert",
    }).id,
  );
  profiles.addConstraint(engineer.id, "без эмодзи", "user", null);

  const calls: RecordedCall[] = [];
  const agent = new PersonalizedChatAgent(
    store,
    memory,
    profiles,
    tasks,
    invariants,
    stubLlm("Готово", calls),
    null,
    { personalization: true },
  );
  const response = await agent.respond(
    conversation.id,
    "Как ускорить сборку?",
    ALL_MEMORY_LAYERS_ENABLED,
    new AbortController().signal,
  );
  await drain(response.stream);

  const systemMessages = calls[0].options?.systemMessages ?? [];
  assert.equal(systemMessages.length, 2);
  assert.match(systemMessages[1], /Профиль пользователя: Инженер \(backend-инженер\)/);
  assert.match(systemMessages[1], /Отвечай кратко/);
  assert.match(systemMessages[1], /формат — сначала код/);
  assert.match(systemMessages[1], /Ограничения: без эмодзи/);
  assert.ok(response.layerTokens.profileTokens > 0);
  assert.equal(
    response.layerTokens.systemTokens +
      response.layerTokens.profileTokens +
      response.layerTokens.longTermTokens +
      response.layerTokens.workingTokens +
      response.layerTokens.shortTermTokens +
      response.layerTokens.requestTokens,
    response.layerTokens.promptTokens,
  );

  memory.close();
  profiles.close();
  tasks.close();
  invariants.close();
  store.close();
});

test("disabled profile layer costs nothing and leaves the prompt neutral", async () => {
  const { store, memory, profiles, tasks, invariants } = await createEnvironment();
  const conversation = store.createConversation();
  profiles.activateProfile(
    profiles.createProfile({ name: "Инженер", verbosity: "brief" }).id,
  );

  const calls: RecordedCall[] = [];
  const agent = new PersonalizedChatAgent(
    store,
    memory,
    profiles,
    tasks,
    invariants,
    stubLlm("Готово", calls),
    null,
    { personalization: true },
  );
  const response = await agent.respond(
    conversation.id,
    "Вопрос",
    { ...ALL_MEMORY_LAYERS_ENABLED, profile: false },
    new AbortController().signal,
  );
  await drain(response.stream);

  assert.equal(calls[0].options?.systemMessages?.length, 1);
  assert.equal(response.layerTokens.profileTokens, 0);
  assert.equal(memory.getLatestUsage(conversation.id)?.profileTokens, 0);
  assert.equal(memory.getLatestUsage(conversation.id)?.layers.profile, false);

  memory.close();
  profiles.close();
  tasks.close();
  invariants.close();
  store.close();
});

test("switching profiles switches both style and remembered facts", async () => {
  const { store, memory, profiles, tasks, invariants } = await createEnvironment();
  const conversation = store.createConversation();
  const base = profiles.getActiveProfile();
  memory.upsertLongTerm({
    profileId: base.id,
    kind: "profile",
    key: "stack",
    value: "TypeScript",
    origin: "user",
    reason: null,
    sourceConversationId: null,
  });

  const novice = profiles.createProfile({ name: "Новичок", verbosity: "detailed" });
  memory.upsertLongTerm({
    profileId: novice.id,
    kind: "profile",
    key: "stack",
    value: "Excel",
    origin: "user",
    reason: null,
    sourceConversationId: null,
  });

  const calls: RecordedCall[] = [];
  const agent = new PersonalizedChatAgent(
    store,
    memory,
    profiles,
    tasks,
    invariants,
    stubLlm("Ответ", calls),
    null,
    { personalization: true },
  );

  await drain(
    (
      await agent.respond(
        conversation.id,
        "Что я использую?",
        ALL_MEMORY_LAYERS_ENABLED,
        new AbortController().signal,
      )
    ).stream,
  );
  profiles.activateProfile(novice.id);
  await drain(
    (
      await agent.respond(
        conversation.id,
        "Что я использую?",
        ALL_MEMORY_LAYERS_ENABLED,
        new AbortController().signal,
      )
    ).stream,
  );

  const firstPrompt = (calls[0].options?.systemMessages ?? []).join("\n");
  const secondPrompt = (calls[1].options?.systemMessages ?? []).join("\n");
  assert.match(firstPrompt, /stack: TypeScript/);
  assert.doesNotMatch(firstPrompt, /stack: Excel/);
  assert.match(secondPrompt, /stack: Excel/);
  assert.match(secondPrompt, /Отвечай подробно/);

  memory.close();
  profiles.close();
  tasks.close();
  invariants.close();
  store.close();
});

test("router updates preferences and constraints automatically", async () => {
  const { store, memory, profiles, tasks, invariants } = await createEnvironment();
  const conversation = store.createConversation();
  const agent = new PersonalizedChatAgent(
    store,
    memory,
    profiles,
    tasks,
    invariants,
    stubLlm("Хорошо", []),
    stubRouter(`{"task": null, "closeTask": false, "writes": [
      {"layer": "profile", "kind": "verbosity", "value": "brief", "reason": "просил короче"},
      {"layer": "profile", "kind": "constraint", "value": "без эмодзи", "reason": null},
      {"layer": "profile", "kind": "verbosity", "value": "очень кратко", "reason": "мусор"}
    ]}`),
    { personalization: true },
  );

  await drain(
    (
      await agent.respond(
        conversation.id,
        "Отвечай короче и без эмодзи",
        ALL_MEMORY_LAYERS_ENABLED,
        new AbortController().signal,
      )
    ).stream,
  );

  const profile = profiles.getActiveProfile();
  assert.equal(profile.verbosity, "brief");
  assert.deepEqual(
    profile.constraints.map((constraint) => constraint.value),
    ["без эмодзи"],
  );
  const writes = memory.listWrites(conversation.id);
  assert.equal(
    writes.filter((write) => write.layer === "profile").length,
    2,
  );

  memory.close();
  profiles.close();
  tasks.close();
  invariants.close();
  store.close();
});

test("a failing router keeps the exchange and the profile untouched", async () => {
  const { store, memory, profiles, tasks, invariants } = await createEnvironment();
  const conversation = store.createConversation();
  const failingRouter: MemoryRouterLlm = {
    model: "deepseek-v4-flash",
    async complete() {
      throw new Error("роутер недоступен");
    },
  };
  const agent = new PersonalizedChatAgent(
    store,
    memory,
    profiles,
    tasks,
    invariants,
    stubLlm("Ответ агента", []),
    failingRouter,
    { personalization: true },
  );

  assert.equal(
    await drain(
      (
        await agent.respond(
          conversation.id,
          "Вопрос",
          ALL_MEMORY_LAYERS_ENABLED,
          new AbortController().signal,
        )
      ).stream,
    ),
    "Ответ агента",
  );

  assert.equal(store.getMessages(conversation.id).length, 2);
  assert.equal(profiles.getActiveProfile().verbosity, "balanced");
  assert.equal(memory.listWrites(conversation.id).length, 0);

  memory.close();
  profiles.close();
  tasks.close();
  invariants.close();
  store.close();
});

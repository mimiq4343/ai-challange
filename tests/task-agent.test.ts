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
  const directory = await mkdtemp(join(tmpdir(), "flash-task-agent-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "chat.sqlite");
  const store = new SqliteConversationStore(databasePath);
  const memory = new SqliteMemoryStore(databasePath);
  const profiles = new SqliteProfileStore(databasePath);
  const tasks = new SqliteTaskStore(databasePath);
  return { store, memory, profiles, tasks, profileId: profiles.getActiveProfile().id };
}

test("the prompt carries stage, current step and expected action", async () => {
  const { store, memory, profiles, tasks, profileId } = await createEnvironment();
  const conversation = store.createConversation();
  const run = tasks.createRun(profileId, "Перенос памяти", "Разложить по слоям");
  tasks.addStep(run.id, "Собрать требования");
  tasks.addStep(run.id, "Спроектировать схему");
  tasks.addStep(run.id, "Обновить API");
  tasks.transition({ runId: run.id, to: "execution", origin: "user", reason: null });
  tasks.updateStep({
    runId: run.id,
    stepId: tasks.listSteps(run.id)[0].id,
    status: "done",
    origin: "user",
  });

  const calls: RecordedCall[] = [];
  const agent = new PersonalizedChatAgent(
    store,
    memory,
    profiles,
    tasks,
    stubLlm("Готово", calls),
    null,
    { personalization: false, taskState: true },
  );
  const response = await agent.respond(
    conversation.id,
    "Продолжаем",
    ALL_MEMORY_LAYERS_ENABLED,
    new AbortController().signal,
  );
  await drain(response.stream);

  const systemMessages = calls[0].options?.systemMessages ?? [];
  assert.equal(systemMessages.length, 2);
  const taskBlock = systemMessages[1];
  assert.match(taskBlock, /Состояние задачи «Перенос памяти»: этап выполнение/);
  assert.match(taskBlock, /Шаг 2 из 3: «Спроектировать схему»/);
  assert.match(taskBlock, /Выполнено: 1\) Собрать требования/);
  assert.match(taskBlock, /Осталось: 3\) Обновить API/);
  assert.match(taskBlock, /Ожидается: агент/);
  assert.ok(response.layerTokens.taskTokens > 0);

  memory.close();
  profiles.close();
  tasks.close();
  store.close();
});

test("the disabled task layer costs nothing", async () => {
  const { store, memory, profiles, tasks, profileId } = await createEnvironment();
  const conversation = store.createConversation();
  const run = tasks.createRun(profileId, "Задача", null);
  tasks.addStep(run.id, "Первый шаг");

  const calls: RecordedCall[] = [];
  const agent = new PersonalizedChatAgent(
    store,
    memory,
    profiles,
    tasks,
    stubLlm("Готово", calls),
    null,
    { personalization: false, taskState: true },
  );
  const response = await agent.respond(
    conversation.id,
    "Вопрос",
    { ...ALL_MEMORY_LAYERS_ENABLED, task: false },
    new AbortController().signal,
  );
  await drain(response.stream);

  assert.equal(calls[0].options?.systemMessages?.length, 1);
  assert.equal(response.layerTokens.taskTokens, 0);
  assert.equal(memory.getLatestUsage(conversation.id)?.taskTokens, 0);

  memory.close();
  profiles.close();
  tasks.close();
  store.close();
});

test("the agent moves the machine, a paused task refuses it", async () => {
  const { store, memory, profiles, tasks, profileId } = await createEnvironment();
  const conversation = store.createConversation();
  const run = tasks.createRun(profileId, "Рассылка", "Запустить рассылку");

  const planningRouter = stubRouter(`{"task": null, "closeTask": false, "writes": [],
    "taskState": {"transition": "execution", "completedSteps": [],
      "newSteps": ["Собрать список", "Написать письмо"],
      "expectedActor": "agent", "expectedAction": "выполнить первый шаг", "block": null}}`);
  const planningAgent = new PersonalizedChatAgent(
    store,
    memory,
    profiles,
    tasks,
    stubLlm("План готов", []),
    planningRouter,
    { personalization: false, taskState: true },
  );
  await drain(
    (
      await planningAgent.respond(
        conversation.id,
        "Составь план",
        ALL_MEMORY_LAYERS_ENABLED,
        new AbortController().signal,
      )
    ).stream,
  );

  assert.equal(tasks.getRun(run.id)?.stage, "execution");
  assert.deepEqual(
    tasks.listSteps(run.id).map((step) => step.title),
    ["Собрать список", "Написать письмо"],
  );

  tasks.setPaused(run.id, true);
  const pausedAgent = new PersonalizedChatAgent(
    store,
    memory,
    profiles,
    tasks,
    stubLlm("Продолжаю", []),
    stubRouter(`{"task": null, "closeTask": false, "writes": [],
      "taskState": {"transition": "validation", "completedSteps": [1], "newSteps": [],
        "expectedActor": "user", "expectedAction": "проверить", "block": null}}`),
    { personalization: false, taskState: true },
  );
  await drain(
    (
      await pausedAgent.respond(
        conversation.id,
        "Двигаемся дальше",
        ALL_MEMORY_LAYERS_ENABLED,
        new AbortController().signal,
      )
    ).stream,
  );

  assert.equal(tasks.getRun(run.id)?.stage, "execution");
  assert.equal(tasks.listSteps(run.id)[0].status, "active");
  assert.equal(tasks.listEvents(run.id)[0].kind, "rejected");
  assert.equal(tasks.listEvents(run.id)[0].origin, "agent");

  memory.close();
  profiles.close();
  tasks.close();
  store.close();
});

test("a multi-step request becomes a proposal, not a task", async () => {
  const { store, memory, profiles, tasks, profileId } = await createEnvironment();
  const conversation = store.createConversation();

  const calls: RecordedCall[] = [];
  const agent = new PersonalizedChatAgent(
    store,
    memory,
    profiles,
    tasks,
    stubLlm("Вот план питания", calls),
    stubRouter(`{"task": null, "closeTask": false, "writes": [], "taskState": null,
      "taskProposal": {"title": "План питания на неделю", "goal": "Меню на 7 дней"}}`),
    { personalization: false, taskState: true },
  );
  await drain(
    (
      await agent.respond(
        conversation.id,
        "Составь план питания на неделю.",
        ALL_MEMORY_LAYERS_ENABLED,
        new AbortController().signal,
      )
    ).stream,
  );

  assert.equal(tasks.getLiveRun(profileId), null);
  const proposal = tasks.getProposal(profileId);
  assert.equal(proposal?.title, "План питания на неделю");
  assert.equal(proposal?.goal, "Меню на 7 дней");
  assert.equal(proposal?.conversationId, conversation.id);

  const accepted = tasks.acceptProposal(profileId);
  assert.equal(accepted?.stage, "planning");
  assert.equal(tasks.getProposal(profileId), null);
  assert.equal(tasks.acceptProposal(profileId), null);

  memory.close();
  profiles.close();
  tasks.close();
  store.close();
});

test("a live task ignores new proposals", async () => {
  const { store, memory, profiles, tasks, profileId } = await createEnvironment();
  const conversation = store.createConversation();
  tasks.createRun(profileId, "Текущая задача", null);

  const agent = new PersonalizedChatAgent(
    store,
    memory,
    profiles,
    tasks,
    stubLlm("Ответ", []),
    stubRouter(`{"task": null, "closeTask": false, "writes": [], "taskState": null,
      "taskProposal": {"title": "Другая задача", "goal": null}}`),
    { personalization: false, taskState: true },
  );
  await drain(
    (
      await agent.respond(
        conversation.id,
        "А ещё составь план питания.",
        ALL_MEMORY_LAYERS_ENABLED,
        new AbortController().signal,
      )
    ).stream,
  );

  assert.equal(tasks.getProposal(profileId), null);
  assert.equal(tasks.getLiveRun(profileId)?.title, "Текущая задача");

  memory.close();
  profiles.close();
  tasks.close();
  store.close();
});

test("the task layer adds the stepwise rules to the system prompt", async () => {
  const { store, memory, profiles, tasks, profileId } = await createEnvironment();
  const conversation = store.createConversation();
  const run = tasks.createRun(profileId, "Задача", null);
  tasks.addStep(run.id, "Первый шаг");

  const withTask: RecordedCall[] = [];
  const withoutTask: RecordedCall[] = [];
  const agentWithTask = new PersonalizedChatAgent(
    store,
    memory,
    profiles,
    tasks,
    stubLlm("Готово", withTask),
    null,
    { personalization: false, taskState: true },
  );
  const agentWithoutTask = new PersonalizedChatAgent(
    store,
    memory,
    profiles,
    tasks,
    stubLlm("Готово", withoutTask),
    null,
    { personalization: false, taskState: false },
  );

  await drain(
    (
      await agentWithTask.respond(
        conversation.id,
        "Продолжаем",
        ALL_MEMORY_LAYERS_ENABLED,
        new AbortController().signal,
      )
    ).stream,
  );
  await drain(
    (
      await agentWithoutTask.respond(
        conversation.id,
        "Просто вопрос",
        ALL_MEMORY_LAYERS_ENABLED,
        new AbortController().signal,
      )
    ).stream,
  );

  assert.match(
    withTask[0].options?.systemMessages?.[0] ?? "",
    /работай ровно над текущим шагом/i,
  );
  assert.doesNotMatch(
    withoutTask[0].options?.systemMessages?.[0] ?? "",
    /работай ровно над текущим шагом/i,
  );

  memory.close();
  profiles.close();
  tasks.close();
  store.close();
});

test("disabled personalization keeps the profile out of the prompt and of the memory", async () => {
  const { store, memory, profiles, tasks, profileId } = await createEnvironment();
  const conversation = store.createConversation();
  tasks.createRun(profileId, "Задача", null);
  profiles.updateProfile(profileId, { name: "Основной", verbosity: "brief" });

  const calls: RecordedCall[] = [];
  const agent = new PersonalizedChatAgent(
    store,
    memory,
    profiles,
    tasks,
    stubLlm("Ответ", calls),
    stubRouter(`{"task": null, "closeTask": false, "writes": [
      {"layer": "profile", "kind": "tone", "value": "direct", "reason": "мимо флага"}
    ], "taskState": null}`),
    { personalization: false, taskState: true },
  );
  const response = await agent.respond(
    conversation.id,
    "Вопрос",
    ALL_MEMORY_LAYERS_ENABLED,
    new AbortController().signal,
  );
  await drain(response.stream);

  const systemMessages = calls[0].options?.systemMessages ?? [];
  assert.equal(
    systemMessages.some((message) => message.startsWith("Профиль пользователя")),
    false,
  );
  assert.equal(response.layerTokens.profileTokens, 0);
  assert.equal(profiles.getActiveProfile().tone, "neutral");

  memory.close();
  profiles.close();
  tasks.close();
  store.close();
});

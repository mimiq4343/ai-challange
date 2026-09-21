import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import type { ChatMessage } from "../src/lib/chat-agent";
import { SqliteConversationStore } from "../src/lib/conversation-store";
import type { ChatRequestOptions } from "../src/lib/conversation-types";
import { parseGuardVerdict, renderRefusal } from "../src/lib/invariant-guard";
import { SqliteInvariantStore } from "../src/lib/invariant-store";
import type { Invariant } from "../src/lib/invariant-types";
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

/** Отдаёт заранее заданные ответы по очереди: сначала guard, затем роутер. */
function scriptedRouter(responses: string[]): MemoryRouterLlm & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    model: "deepseek-v4-flash",
    async complete(input) {
      calls.push(input.systemPrompt.slice(0, 40));
      return { content: responses.shift() ?? '{"verdict": "allow"}', usage: null };
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
  const directory = await mkdtemp(join(tmpdir(), "flash-invariant-agent-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "chat.sqlite");
  const store = new SqliteConversationStore(databasePath);
  const memory = new SqliteMemoryStore(databasePath);
  const profiles = new SqliteProfileStore(databasePath);
  const tasks = new SqliteTaskStore(databasePath);
  const invariants = new SqliteInvariantStore(databasePath);
  return { store, memory, profiles, tasks, invariants, profileId: profiles.getActiveProfile().id };
}

function sampleInvariant(id: number): Invariant {
  return {
    id,
    profileId: 1,
    category: "stack",
    statement: "Только PostgreSQL, без ORM",
    rationale: "команда держит SQL под контролем",
    status: "active",
    blockedCount: 0,
    origin: "user",
    createdAt: "2026-09-21T10:00:00.000Z",
    updatedAt: "2026-09-21T10:00:00.000Z",
  };
}

test("an unreadable or unknown verdict never blocks the user", () => {
  assert.deepEqual(parseGuardVerdict("не json", [1]), { verdict: "allow" });
  assert.deepEqual(parseGuardVerdict('{"verdict": "conflict"}', [1]), { verdict: "allow" });
  assert.deepEqual(
    parseGuardVerdict(
      '{"verdict": "conflict", "invariantIds": [42], "explanation": "нарушает"}',
      [1],
    ),
    { verdict: "allow" },
  );
  assert.deepEqual(
    parseGuardVerdict(
      '{"verdict": "conflict", "invariantIds": [1], "explanation": "MongoDB вместо PostgreSQL", "alternative": "остаться на PostgreSQL"}',
      [1],
    ),
    {
      verdict: "conflict",
      invariantIds: [1],
      explanation: "MongoDB вместо PostgreSQL",
      alternative: "остаться на PostgreSQL",
    },
  );
});

test("the refusal quotes the rule and offers a way forward", () => {
  const text = renderRefusal(
    {
      verdict: "conflict",
      invariantIds: [7],
      explanation: "Prisma — это ORM",
      alternative: "оставить SQL-запросы в репозиториях",
    },
    [{ ...sampleInvariant(7) }],
  );

  assert.match(text, /нарушает инвариант проекта/);
  assert.match(text, /Только PostgreSQL, без ORM/);
  assert.match(text, /Почему: команда держит SQL под контролем/);
  assert.match(text, /В чём конфликт: Prisma — это ORM/);
  assert.match(text, /Что можно сделать вместо этого: оставить SQL-запросы/);
  assert.match(text, /панели инвариантов/);
});

test("a conflicting request never reaches the chat model", async () => {
  const { store, memory, profiles, tasks, invariants, profileId } = await createEnvironment();
  const conversation = store.createConversation();
  const rule = invariants.create(
    profileId,
    {
      category: "stack",
      statement: "Только PostgreSQL, без ORM",
      rationale: "команда держит SQL под контролем",
    },
    "user",
  );

  const calls: RecordedCall[] = [];
  const router = scriptedRouter([
    `{"verdict": "conflict", "invariantIds": [${rule.id}], "explanation": "MongoDB и Prisma нарушают правило", "alternative": "остаться на PostgreSQL с SQL-запросами"}`,
  ]);
  const agent = new PersonalizedChatAgent(
    store,
    memory,
    profiles,
    tasks,
    invariants,
    stubLlm("Этого ответа быть не должно", calls),
    router,
    { personalization: false, taskState: false, invariants: true },
  );

  const response = await agent.respond(
    conversation.id,
    "Давай возьмём MongoDB и Prisma.",
    ALL_MEMORY_LAYERS_ENABLED,
    new AbortController().signal,
  );
  const text = await drain(response.stream);

  assert.equal(calls.length, 0);
  assert.deepEqual(response.blockedBy, [rule.id]);
  assert.match(text, /Только PostgreSQL, без ORM/);
  assert.equal(invariants.getInvariant(rule.id)?.blockedCount, 1);
  assert.equal(invariants.listEvents(profileId)[0].kind, "violation_blocked");

  const messages = store.getMessages(conversation.id);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].content, "Давай возьмём MongoDB и Prisma.");
  assert.match(messages[1].content, /нарушает инвариант проекта/);
  assert.ok((memory.getLatestUsage(conversation.id)?.invariantTokens ?? 0) > 0);

  memory.close();
  profiles.close();
  tasks.close();
  invariants.close();
  store.close();
});

test("retiring the rule lets the same request through", async () => {
  const { store, memory, profiles, tasks, invariants, profileId } = await createEnvironment();
  const conversation = store.createConversation();
  const rule = invariants.create(
    profileId,
    { category: "stack", statement: "Только PostgreSQL, без ORM", rationale: null },
    "user",
  );
  invariants.setStatus(rule.id, "retired");

  const calls: RecordedCall[] = [];
  const router = scriptedRouter(['{"task": null, "closeTask": false, "writes": []}']);
  const agent = new PersonalizedChatAgent(
    store,
    memory,
    profiles,
    tasks,
    invariants,
    stubLlm("Вот вариант с MongoDB", calls),
    router,
    { personalization: false, taskState: false, invariants: true },
  );

  const response = await agent.respond(
    conversation.id,
    "Давай возьмём MongoDB и Prisma.",
    ALL_MEMORY_LAYERS_ENABLED,
    new AbortController().signal,
  );
  assert.equal(await drain(response.stream), "Вот вариант с MongoDB");
  assert.equal(calls.length, 1);
  assert.deepEqual(response.blockedBy, []);
  assert.equal(response.layerTokens.invariantTokens, 0);

  memory.close();
  profiles.close();
  tasks.close();
  invariants.close();
  store.close();
});

test("the active rules reach the prompt and the disabled layer skips the guard", async () => {
  const { store, memory, profiles, tasks, invariants, profileId } = await createEnvironment();
  const conversation = store.createConversation();
  invariants.create(
    profileId,
    { category: "architecture", statement: "Монолит до 100k MAU", rationale: null },
    "user",
  );

  const withLayer: RecordedCall[] = [];
  const routerWithLayer = scriptedRouter([
    '{"verdict": "allow"}',
    '{"task": null, "closeTask": false, "writes": []}',
  ]);
  const agent = new PersonalizedChatAgent(
    store,
    memory,
    profiles,
    tasks,
    invariants,
    stubLlm("Ответ", withLayer),
    routerWithLayer,
    { personalization: false, taskState: false, invariants: true },
  );
  await drain(
    (
      await agent.respond(
        conversation.id,
        "Как масштабировать сервис?",
        ALL_MEMORY_LAYERS_ENABLED,
        new AbortController().signal,
      )
    ).stream,
  );

  assert.match(withLayer[0].options?.systemMessages?.[1] ?? "", /Монолит до 100k MAU/);
  assert.equal(routerWithLayer.calls.length, 2);

  const withoutLayer: RecordedCall[] = [];
  const routerWithoutLayer = scriptedRouter([
    '{"task": null, "closeTask": false, "writes": []}',
  ]);
  const plainAgent = new PersonalizedChatAgent(
    store,
    memory,
    profiles,
    tasks,
    invariants,
    stubLlm("Ответ", withoutLayer),
    routerWithoutLayer,
    { personalization: false, taskState: false, invariants: true },
  );
  const plain = await plainAgent.respond(
    conversation.id,
    "Как масштабировать сервис?",
    { ...ALL_MEMORY_LAYERS_ENABLED, invariants: false },
    new AbortController().signal,
  );
  await drain(plain.stream);

  assert.equal(withoutLayer[0].options?.systemMessages?.length, 1);
  assert.equal(plain.layerTokens.invariantTokens, 0);
  assert.equal(routerWithoutLayer.calls.length, 1);

  memory.close();
  profiles.close();
  tasks.close();
  invariants.close();
  store.close();
});

test("the router proposal becomes a pending invariant", async () => {
  const { store, memory, profiles, tasks, invariants, profileId } = await createEnvironment();
  const conversation = store.createConversation();
  const router = scriptedRouter([
    `{"task": null, "closeTask": false, "writes": [], "invariantProposals": [
      {"category": "stack", "statement": "Только PostgreSQL, без ORM", "rationale": "решение команды"},
      {"category": "unknown", "statement": "мусор", "rationale": null}
    ]}`,
  ]);
  const agent = new PersonalizedChatAgent(
    store,
    memory,
    profiles,
    tasks,
    invariants,
    stubLlm("Принято", []),
    router,
    { personalization: false, taskState: false, invariants: true },
  );

  await drain(
    (
      await agent.respond(
        conversation.id,
        "Решили: только PostgreSQL, без ORM.",
        ALL_MEMORY_LAYERS_ENABLED,
        new AbortController().signal,
      )
    ).stream,
  );

  const proposals = invariants.listProposals(profileId);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].statement, "Только PostgreSQL, без ORM");
  assert.equal(invariants.listActive(profileId).length, 0);

  memory.close();
  profiles.close();
  tasks.close();
  invariants.close();
  store.close();
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SqliteConversationStore } from "../src/lib/conversation-store";
import { RagChatAgent } from "../src/lib/rag-chat-agent";
import { applyTaskMemoryPatch } from "../src/lib/rag-task-memory";
import { emptyRagTaskState } from "../src/lib/rag-chat-types";
import { groundingLlm } from "./helpers/rag-grounding";
import { refinementIndex, testEmbedder, testSettings } from "./helpers/rag-refinement";

async function setup(t: { after(fn: () => Promise<void>): void }) {
  const directory = await mkdtemp(join(tmpdir(), "flash-rag-agent-"));
  const store = new SqliteConversationStore(join(directory, "chat.sqlite"));
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  return store;
}

test("coordinated user constraints persist verbatim server evidence and keep the previous goal", async (t) => {
  const store = await setup(t);
  const id = store.createConversation().id;
  const goal = "Проверить надёжность истории Day 7";
  const content = "Разбираем только Day 7, без замены SQLite и новых зависимостей. Как openChatDatabase настраивает журнал?";
  const llm = groundingLlm((prompt, payload) => {
    if (prompt.includes("QUERY_REWRITE")) return JSON.stringify({ query: JSON.parse(payload).question });
    if (!prompt.includes("RAG_TASK_MEMORY")) return;
    const input = JSON.parse(payload);
    const evidence = input.evidenceOptions ? { evidenceId: input.evidenceOptions[0].id } : { evidence: input.content === content ? "без новых зависимостей" : input.content };
    return JSON.stringify({ goal: input.content.startsWith("Цель:") ? { value: goal, ...evidence } : null,
      upsert: input.content === content ? [
        { kind: "constraints", key: "Область", value: "Только Day 7", ...evidence },
        { kind: "constraints", key: "Изменения", value: "Без замены SQLite и новых зависимостей", ...evidence },
      ] : [], remove: [], question: input.content === content ? content : "Как сохраняются сообщения?" });
  });
  const agent = new RagChatAgent(store, llm, { index: await refinementIndex(t), embedder: testEmbedder });
  await agent.respond(id, `Цель: ${goal}`, testSettings, new AbortController().signal);
  const saved = await agent.respond(id, content, testSettings, new AbortController().signal);
  assert.equal(saved.messages.length, 4);
  assert.equal(saved.taskState.goal!.value, goal);
  assert.equal(saved.taskState.goal!.turn, 1);
  assert.deepEqual(saved.taskState.constraints, [
    { key: "Область", value: "Только Day 7", evidence: content, turn: 2 },
    { key: "Изменения", value: "Без замены SQLite и новых зависимостей", evidence: content, turn: 2 },
  ]);
  assert.ok(saved.exchanges[1].answer.result.sources.length > 0);
  assert.ok(saved.exchanges[1].answer.quotes.length > 0);
});

test("long messages retain bounded evidence from the selected paragraph of the current user turn", async (t) => {
  const store = await setup(t);
  const id = store.createConversation().id;
  const content = `${"А".repeat(1980)}\n\nОграничение: без новых зависимостей.`;
  const llm = groundingLlm((prompt, payload) => {
    if (!prompt.includes("RAG_TASK_MEMORY")) return;
    const input = JSON.parse(payload);
    const option = input.evidenceOptions.find((row: { text: string }) => row.text === "Ограничение: без новых зависимостей.");
    return JSON.stringify({ goal: null, upsert: [{ kind: "constraints", key: "Зависимости", value: "Без новых зависимостей", evidenceId: option.id }], remove: [], question: "Как сохраняются сообщения?" });
  });
  const saved = await new RagChatAgent(store, llm, { index: await refinementIndex(t), embedder: testEmbedder }).respond(id, content, testSettings, new AbortController().signal);
  assert.deepEqual(saved.taskState.constraints, [{ key: "Зависимости", value: "Без новых зависимостей", evidence: "Ограничение: без новых зависимостей.", turn: 1 }]);
  assert.equal(saved.messages[0].content, content);
  assert.equal(saved.messages.length, 2);
});

test("task memory survives beyond the prompt tail; a correction replaces the original term", async (t) => {
  const store = await setup(t);
  const id = store.createConversation().id;
  const llm = groundingLlm((prompt, payload) => {
    const input = JSON.parse(payload);
    if (prompt.includes("RAG_TASK_MEMORY")) {
      return JSON.stringify({ goal: input.content.includes("Цель:") ? { value: "Проверить сохранение", evidenceId: input.evidenceOptions[0].id } : null,
        upsert: input.content.includes("обмен") ? [{ kind: "terms", key: "обмен", value: input.content.includes("Исправление") ? "user + assistant" : "Одно сообщение", evidenceId: input.evidenceOptions[0].id }]: [],
        remove: [], question: "Как сохраняются сообщения?" });
    }
    if (prompt.includes("GROUNDED_RAG_ANSWER")) {
      const source = input.context[0];
      return JSON.stringify({ status: "answered", answer: `Цель: ${input.taskState.goal.value}. Определение обмена: ${input.taskState.terms[0]?.value ?? "не задано"}. Оба сообщения сохраняются атомарно [S1].`, clarification: null,
        sources: [{ id: source.id, source: source.source, section: source.section, chunkId: source.chunkId }], quotes: [{ sourceId: source.id, quoteId: source.quoteOptions.find((option: { text: string }) => option.text.includes("Atomic transactions commit both messages.")).id }] });
    }
  });
  const agent = new RagChatAgent(store, llm, { index: await refinementIndex(t), embedder: testEmbedder });
  for (const content of ["Цель: Проверить сохранение", "Термин обмен означает Одно сообщение", "Продолжай", "А дальше?", "Продолжай", "Исправление: обмен означает user + assistant", "Вернись к цели"]) {
    await agent.respond(id, content, testSettings, new AbortController().signal);
  }
  const saved = store.getRagChat(id)!;
  assert.equal(saved.messages.length, 14);
  assert.equal(saved.taskState.goal!.value, "Проверить сохранение");
  assert.equal(saved.taskState.terms.length, 1);
  assert.equal(saved.taskState.terms[0].value, "user + assistant");
  assert.match(saved.messages.at(-1)!.content, /Цель: Проверить сохранение/);
  assert.match(saved.messages.at(-1)!.content, /user \+ assistant/);
  assert.equal(saved.exchanges.length, 7);
  assert.ok(saved.exchanges.every((exchange) => exchange.answer.result.sources.length && exchange.answer.quotes.length));
});

test("a failed, truncated or cancelled memory/generation stage never commits an exchange or a new goal", async (t) => {
  const store = await setup(t);
  const index = await refinementIndex(t);
  for (const fault of ["json", "quote", "rewrittenQuote", "truncated", "usage", "aborted", "generation"]) {
    const id = store.createConversation().id;
    const controller = new AbortController();
    const base = groundingLlm((prompt) => {
      if (prompt.includes("RAG_TASK_MEMORY")) {
        if (fault === "json") return "invalid";
        if (fault === "aborted") controller.abort();
        return JSON.stringify({ goal: { value: "Аудит", ...(fault === "rewrittenQuote" ? { evidence: "Выдуманная цель" } : { evidenceId: fault === "quote" ? "E404" : "E1" }) }, upsert: [], remove: [], question: "Как сохранять?" });
      }
      if (prompt.includes("GROUNDED_RAG_ANSWER") && fault === "generation") throw new Error("provider failure");
    });
    const llm = { model: base.model, async respond(...args: Parameters<typeof base.respond>) {
      const result = await base.respond(...args);
      return { ...result, finishReason: Promise.resolve(fault === "truncated" ? "length" : "stop"), usage: fault === "usage" ? Promise.resolve(null) : result.usage };
    } };
    await assert.rejects(new RagChatAgent(store, llm, { index, embedder: testEmbedder }).respond(id, "Аудит", testSettings, controller.signal));
    assert.equal(store.getMessages(id).length, 0);
    assert.equal(store.getRagChat(id)!.taskState.goal, null);
  }
});

test("explicit refusal still persists the completed conversation and its user constraints without invented sources", async (t) => {
  const store = await setup(t);
  const id = store.createConversation().id;
  const llm = groundingLlm((prompt, payload) => {
    if (prompt.includes("RAG_TASK_MEMORY")) return JSON.stringify({ goal: { value: "Аудит", evidenceId: "E1" }, upsert: [], remove: [], question: "Погода на Марсе?" });
    if (prompt.includes("RELEVANCE_RERANK")) return JSON.stringify({ results: JSON.parse(payload).candidates.map((source: { id: string }) => ({ id: source.id, score: 0, reason: "Вне корпуса" })) });
  });
  const saved = await new RagChatAgent(store, llm, { index: await refinementIndex(t), embedder: testEmbedder }).respond(id, "Аудит", testSettings, new AbortController().signal);
  assert.equal(saved.messages.length, 2);
  assert.equal(saved.taskState.goal!.value, "Аудит");
  assert.equal(saved.exchanges[0].answer.status, "unknown");
  assert.deepEqual(saved.exchanges[0].answer.result.sources, []);
  assert.deepEqual(saved.exchanges[0].answer.quotes, []);
  assert.ok(saved.exchanges[0].answer.result.usage.totalTokens > 0);
  assert.deepEqual(saved.exchanges[0].answer.result.usage, saved.exchanges[0].answer.usage);
});

test("memory patches preserve untouched constraints and reject fabricated provenance or ambiguous duplicates", () => {
  const first = applyTaskMemoryPatch(emptyRagTaskState(), { goal: null, upsert: [{ kind: "constraints", key: "БД", value: "SQLite", evidenceId: "E1" }], remove: [], question: "SQLite" }, "Только SQLite", 1);
  const second = applyTaskMemoryPatch(first.taskState, { goal: null, upsert: [], remove: [], question: "Далее?" }, "Далее?", 2);
  assert.deepEqual(second.taskState.constraints, [{ key: "БД", value: "SQLite", evidence: "Только SQLite", turn: 1 }]);
  assert.throws(() => applyTaskMemoryPatch(first.taskState, { goal: null, upsert: [{ kind: "constraints", key: "БД", value: "Postgres", evidenceId: "E404" }], remove: [], question: "Далее?" }, "Далее?", 2), /отсутствующий фрагмент/);
  assert.throws(() => applyTaskMemoryPatch(first.taskState, { goal: null, upsert: [], remove: [{ kind: "constraints", key: "БД", evidenceId: "E1" }, { kind: "constraints", key: "БД", evidenceId: "E1" }], question: "SQLite" }, "SQLite", 2), /повторяется/);
  const removed = applyTaskMemoryPatch(first.taskState, { goal: null, upsert: [], remove: [{ kind: "constraints", key: "БД", evidenceId: "E1" }], question: "Отменяю ограничение SQLite" }, "Отменяю ограничение SQLite", 2);
  assert.deepEqual(removed.taskState.constraints, []);
});

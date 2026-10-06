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

test("task memory survives beyond the prompt tail; a correction replaces the original term", async (t) => {
  const store = await setup(t);
  const id = store.createConversation().id;
  const llm = groundingLlm((prompt, payload) => {
    const input = JSON.parse(payload);
    if (prompt.includes("RAG_TASK_MEMORY")) {
      return JSON.stringify({ goal: input.content.includes("Цель:") ? { value: "Проверить сохранение", evidence: "Проверить сохранение" } : null,
        upsert: input.content.includes("обмен") ? [{ kind: "terms", key: "обмен", value: input.content.includes("Исправление") ? "user + assistant" : "Одно сообщение", evidence: input.content }]: [],
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
  for (const fault of ["json", "quote", "truncated", "usage", "aborted", "generation"]) {
    const id = store.createConversation().id;
    const controller = new AbortController();
    const base = groundingLlm((prompt) => {
      if (prompt.includes("RAG_TASK_MEMORY")) {
        if (fault === "json") return "invalid";
        if (fault === "aborted") controller.abort();
        return JSON.stringify({ goal: { value: "Аудит", evidence: fault === "quote" ? "Выдуманная цель" : "Аудит" }, upsert: [], remove: [], question: "Как сохранять?" });
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
    if (prompt.includes("RAG_TASK_MEMORY")) return JSON.stringify({ goal: { value: "Аудит", evidence: "Аудит" }, upsert: [], remove: [], question: "Погода на Марсе?" });
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
  const first = applyTaskMemoryPatch(emptyRagTaskState(), { goal: null, upsert: [{ kind: "constraints", key: "БД", value: "SQLite", evidence: "SQLite" }], remove: [], question: "SQLite" }, "Только SQLite", 1);
  const second = applyTaskMemoryPatch(first.taskState, { goal: null, upsert: [], remove: [], question: "Далее?" }, "Далее?", 2);
  assert.deepEqual(second.taskState.constraints, [{ key: "БД", value: "SQLite", evidence: "SQLite", turn: 1 }]);
  assert.throws(() => applyTaskMemoryPatch(first.taskState, { goal: null, upsert: [{ kind: "constraints", key: "БД", value: "Postgres", evidence: "Postgres" }], remove: [], question: "Далее?" }, "Далее?", 2), /не подтверждено/);
  assert.throws(() => applyTaskMemoryPatch(first.taskState, { goal: null, upsert: [], remove: [{ kind: "constraints", key: "БД", evidence: "SQLite" }, { kind: "constraints", key: "БД", evidence: "SQLite" }], question: "SQLite" }, "SQLite", 2), /повторяется/);
});

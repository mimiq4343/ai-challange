import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { RagChatAgent } from "../src/lib/rag-chat-agent";
import { ragChatResponse } from "../src/lib/rag-chat-http";
import { SqliteConversationStore } from "../src/lib/conversation-store";
import { groundingLlm } from "./helpers/rag-grounding";
import { refinementIndex, testEmbedder, testSettings } from "./helpers/rag-refinement";

test("RAG chat HTTP rejects injected memory/history and invalid input before calling the model", async () => {
  const forbidden = () => { assert.fail("Invalid requests must not construct the agent"); };
  for (const payload of [{ content: "Вопрос", settings: testSettings, history: [] }, { content: "Вопрос", settings: testSettings, taskState: {} }, { content: "", settings: testSettings }, { content: "Вопрос", settings: {} }]) {
    const result = await ragChatResponse(new Request("http://localhost/test", { method: "POST", body: JSON.stringify(payload) }), "id", forbidden);
    assert.equal(result.status, 400);
  }
  const cancelled = await ragChatResponse(new Request("http://localhost/test", { method: "POST", body: JSON.stringify({ content: "Вопрос", settings: testSettings }), signal: AbortSignal.abort() }), "id", forbidden);
  assert.equal(cancelled.status, 499);
});

test("RAG chat HTTP returns only a committed snapshot with sources and maps missing conversations to 404", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "flash-rag-http-"));
  const store = new SqliteConversationStore(join(directory, "chat.sqlite"));
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  const llm = groundingLlm((prompt) => prompt.includes("RAG_TASK_MEMORY") ? JSON.stringify({ goal: null, upsert: [], remove: [], question: "Как сохранять?" }) : undefined);
  const agent = new RagChatAgent(store, llm, { index: await refinementIndex(t), embedder: testEmbedder });
  const request = () => new Request("http://localhost/test", { method: "POST", body: JSON.stringify({ content: "Как сохранять?", settings: testSettings }) });
  assert.equal((await ragChatResponse(request(), "missing", () => agent)).status, 404);
  const id = store.createConversation().id;
  const response = await ragChatResponse(request(), id, () => agent);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const { detail } = await response.json();
  assert.ok(detail);
  const saved = store.getRagChat(id);
  assert.ok(saved);
  assert.deepEqual(detail, saved);
  assert.ok(detail.exchanges[0].answer.result.sources.length);
  assert.ok(detail.exchanges[0].answer.quotes.length);
});

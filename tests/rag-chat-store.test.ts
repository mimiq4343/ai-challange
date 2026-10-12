import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { SqliteConversationStore } from "../src/lib/conversation-store";
import { GroundedRagAgent } from "../src/lib/rag-grounding-agent";
import { openChatDatabase, releaseChatDatabase } from "../src/lib/sqlite-database";
import { groundingLlm } from "./helpers/rag-grounding";
import { refinementIndex, testEmbedder, testSettings } from "./helpers/rag-refinement";

const state = { goal: { value: "Проверить историю", evidence: "Проверить историю", turn: 1 }, clarifications: [], constraints: [], terms: [] };

test("RAG exchange restores history, task memory and immutable source snapshots after reopening", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "flash-rag-chat-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "chat.sqlite");
  const first = new SqliteConversationStore(path);
  const conversation = first.createConversation();
  const answer = await new GroundedRagAgent(groundingLlm(), { index: await refinementIndex(t), embedder: testEmbedder }).respond("Проверить историю", testSettings, new AbortController().signal);
  first.saveExchange(conversation.id, "Проверить историю", answer.result.answer, undefined, undefined, { expectedLastMessageId: null, taskState: state, answer });
  first.close();
  const restored = new SqliteConversationStore(path);
  t.after(() => restored.close());
  const snapshot = restored.getRagChat(conversation.id)!;
  assert.equal(snapshot.messages.length, 2);
  assert.deepEqual(snapshot.taskState, state);
  assert.deepEqual(snapshot.exchanges[0].answer, answer);
  assert.equal(snapshot.exchanges[0].assistantMessageId, snapshot.messages[1].id);
  assert.equal(restored.deleteConversation(conversation.id), true);
  assert.equal(restored.getRagChat(conversation.id), null);
  const database = openChatDatabase(path);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM rag_chat_exchanges").get()!.count, 0);
  releaseChatDatabase(path);
});

test("a failed metadata insert rolls back both messages, title and task memory", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "flash-rag-rollback-"));
  const path = join(directory, "chat.sqlite");
  const store = new SqliteConversationStore(path);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  const conversation = store.createConversation();
  store.getRagChat(conversation.id);
  const database = openChatDatabase(path);
  database.exec("CREATE TRIGGER reject_rag BEFORE INSERT ON rag_chat_exchanges BEGIN SELECT RAISE(ABORT, 'metadata failure'); END;");
  releaseChatDatabase(path);
  const answer = await new GroundedRagAgent(groundingLlm(), { index: await refinementIndex(t), embedder: testEmbedder }).respond("Проверить историю", testSettings, new AbortController().signal);
  assert.throws(() => store.saveExchange(conversation.id, "Проверить историю", answer.result.answer, undefined, undefined, { expectedLastMessageId: null, taskState: state, answer }), /metadata failure/);
  assert.equal(store.getMessages(conversation.id).length, 0);
  assert.deepEqual(store.getRagChat(conversation.id)!.taskState, { goal: null, clarifications: [], constraints: [], terms: [] });
  assert.deepEqual(store.getConversation(conversation.id), conversation);
});

test("concurrent stale history and invalid evidence cannot overwrite task memory or commit messages", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "flash-rag-conflict-"));
  const store = new SqliteConversationStore(join(directory, "chat.sqlite"));
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  const conversation = store.createConversation();
  const answer = await new GroundedRagAgent(groundingLlm(), { index: await refinementIndex(t), embedder: testEmbedder }).respond("Проверить историю", testSettings, new AbortController().signal);
  const input = { expectedLastMessageId: null, taskState: state, answer };
  store.saveExchange(conversation.id, "Проверить историю", answer.result.answer, undefined, undefined, input);
  assert.throws(() => store.saveExchange(conversation.id, "Проверить историю", answer.result.answer, undefined, undefined, input), /Диалог изменился/);
  const before = store.getRagChat(conversation.id)!;
  const corrupted = structuredClone(answer);
  corrupted.quotes[0].text = "Fabricated quote not present in any source.";
  assert.throws(() => store.saveExchange(conversation.id, "Вопрос", corrupted.result.answer, undefined, undefined, { ...input, expectedLastMessageId: before.messages.at(-1)!.id, answer: corrupted }), /Цитата/);
  assert.deepEqual(store.getRagChat(conversation.id), before);
});

test("a RAG snapshot never mixes memory and messages from concurrent SQLite commits", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "flash-rag-snapshot-"));
  const path = join(directory, "chat.sqlite");
  const store = new SqliteConversationStore(path);
  const writer = new DatabaseSync(path, { timeout: 5_000 });
  writer.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  t.after(async () => { writer.close(); store.close(); await rm(directory, { recursive: true, force: true }); });
  const id = store.createConversation().id;
  const answer = await new GroundedRagAgent(groundingLlm(), { index: await refinementIndex(t), embedder: testEmbedder }).respond("Проверить историю", testSettings, new AbortController().signal);
  store.saveExchange(id, "Проверить историю", answer.result.answer, undefined, undefined, { expectedLastMessageId: null, taskState: state, answer });
  const before = store.getRagChat(id)!;
  const getMessages = store.getMessages.bind(store);
  let committed = false;
  store.getMessages = (conversationId) => {
    if (!committed) {
      committed = true;
      const timestamp = new Date(Date.now() + 1_000).toISOString();
      const nextState = { ...state, goal: { value: "Новая цель", evidence: "Новая цель", turn: 2 } };
      writer.exec("BEGIN IMMEDIATE");
      const insert = writer.prepare("INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)");
      insert.run(id, "user", "Новая цель", timestamp);
      const assistantId = insert.run(id, "assistant", answer.result.answer, timestamp).lastInsertRowid;
      writer.prepare("INSERT INTO rag_chat_exchanges (assistant_message_id, conversation_id, task_state_json, answer_json) VALUES (?, ?, ?, ?)").run(assistantId, id, JSON.stringify(nextState), JSON.stringify(answer));
      writer.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(timestamp, id);
      writer.exec("COMMIT");
    }
    return getMessages(conversationId);
  };
  assert.deepEqual(store.getRagChat(id), before);
  const after = store.getRagChat(id)!;
  assert.equal(after.messages.length, 4);
  assert.equal(after.exchanges.length, 2);
  assert.equal(after.taskState.goal?.value, "Новая цель");
});

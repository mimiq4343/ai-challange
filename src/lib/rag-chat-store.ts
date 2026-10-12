import type { openChatDatabase } from "./sqlite-database";
import { RagError } from "./rag-agent";
import { parseGroundedAnswer } from "./rag-grounding-validation";
import type { RagChatCommit, RagChatExchange } from "./rag-chat-types";
import { validateRagTaskState } from "./rag-task-memory";

type Database = ReturnType<typeof openChatDatabase>;

export function ensureRagChatSchema(database: Database): void {
  database.exec(`CREATE TABLE IF NOT EXISTS rag_chat_exchanges (
    assistant_message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    task_state_json TEXT NOT NULL CHECK(json_valid(task_state_json)),
    answer_json TEXT NOT NULL CHECK(json_valid(answer_json))
  ) STRICT;
  CREATE INDEX IF NOT EXISTS rag_chat_conversation_idx ON rag_chat_exchanges(conversation_id, assistant_message_id);`);
}

export function readRagChatExchanges(database: Database, conversationId: string): RagChatExchange[] {
  const rows = database.prepare("SELECT assistant_message_id, task_state_json, answer_json FROM rag_chat_exchanges WHERE conversation_id = ? ORDER BY assistant_message_id").all(conversationId) as { assistant_message_id: number; task_state_json: string; answer_json: string }[];
  return rows.map((row) => ({ assistantMessageId: row.assistant_message_id, taskState: validateRagTaskState(JSON.parse(row.task_state_json)), answer: JSON.parse(row.answer_json) }));
}

export function checkRagChatCursor(database: Database, conversationId: string, expected: number | null): void {
  const row = database.prepare("SELECT MAX(id) AS id FROM messages WHERE conversation_id = ?").get(conversationId) as { id: number | null };
  if (row.id !== expected) throw new RagError("Диалог изменился во время ответа. Загрузите актуальную историю и повторите вопрос.", 409);
}

export function writeRagChatExchange(database: Database, conversationId: string, assistantMessageId: number, input: RagChatCommit): void {
  const { answer } = input;
  parseGroundedAnswer(JSON.stringify({ status: answer.status, answer: answer.result.answer, clarification: answer.clarification,
    sources: answer.result.sources.map(({ id, source, section, chunkId }) => ({ id, source, section, chunkId })),
    quotes: answer.quotes.map(({ sourceId, text }) => ({ sourceId, text })) }), answer.result.sources);
  const taskState = validateRagTaskState(input.taskState);
  const userMessages = database.prepare("SELECT content FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY id").all(conversationId) as { content: string }[];
  for (const fact of [...(taskState.goal ? [taskState.goal] : []), ...taskState.clarifications, ...taskState.constraints, ...taskState.terms]) {
    if (!userMessages[fact.turn - 1]?.content.includes(fact.evidence)) throw new RagError("Память задачи ссылается на отсутствующее уточнение пользователя.", 502);
  }
  database.prepare("INSERT INTO rag_chat_exchanges (assistant_message_id, conversation_id, task_state_json, answer_json) VALUES (?, ?, ?, ?)")
    .run(assistantMessageId, conversationId, JSON.stringify(taskState), JSON.stringify(answer));
}

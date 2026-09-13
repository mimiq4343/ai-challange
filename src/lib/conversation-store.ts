import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { ConversationSummary, MessageRole, StoredMessage } from "./conversation-types";

const NEW_CONVERSATION_TITLE = "Новый диалог";
const TITLE_LENGTH = 60;

type ConversationRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: number;
  conversation_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
};

export class ConversationNotFoundError extends Error {
  readonly conversationId: string;

  constructor(conversationId: string) {
    super(`Диалог ${conversationId} не найден.`);
    this.name = "ConversationNotFoundError";
    this.conversationId = conversationId;
  }
}


export class SqliteConversationStore {
  private readonly database: DatabaseSync;
  private readonly listConversationsStatement: StatementSync;
  private readonly insertConversationStatement: StatementSync;
  private readonly getConversationStatement: StatementSync;
  private readonly getMessagesStatement: StatementSync;
  private readonly insertMessageStatement: StatementSync;
  private readonly updateConversationStatement: StatementSync;
  private readonly deleteConversationStatement: StatementSync;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath, { timeout: 5_000 });
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL
          REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS messages_conversation_id_id
        ON messages(conversation_id, id);
    `);

    this.listConversationsStatement = this.database.prepare(`
      SELECT id, title, created_at, updated_at
      FROM conversations
      ORDER BY updated_at DESC, created_at DESC, id DESC
    `);
    this.insertConversationStatement = this.database.prepare(`
      INSERT INTO conversations (id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `);
    this.getConversationStatement = this.database.prepare(`
      SELECT id, title, created_at, updated_at
      FROM conversations
      WHERE id = ?
    `);
    this.getMessagesStatement = this.database.prepare(`
      SELECT id, conversation_id, role, content, created_at
      FROM messages
      WHERE conversation_id = ?
      ORDER BY id ASC
    `);
    this.insertMessageStatement = this.database.prepare(`
      INSERT INTO messages (conversation_id, role, content, created_at)
      VALUES (?, ?, ?, ?)
    `);
    this.updateConversationStatement = this.database.prepare(`
      UPDATE conversations
      SET title = ?, updated_at = ?
      WHERE id = ?
    `);
    this.deleteConversationStatement = this.database.prepare(`
      DELETE FROM conversations
      WHERE id = ?
    `);
  }

  listConversations(): ConversationSummary[] {
    return (this.listConversationsStatement.all() as ConversationRow[]).map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  createConversation(): ConversationSummary {
    const timestamp = new Date().toISOString();
    const conversation = {
      id: randomUUID(),
      title: NEW_CONVERSATION_TITLE,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.insertConversationStatement.run(
      conversation.id,
      conversation.title,
      conversation.createdAt,
      conversation.updatedAt,
    );

    return conversation;
  }

  getConversation(id: string): ConversationSummary | null {
    const row = this.getConversationStatement.get(id) as ConversationRow | undefined;
    return row
      ? {
          id: row.id,
          title: row.title,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
      : null;
  }

  getMessages(conversationId: string): StoredMessage[] {
    return (this.getMessagesStatement.all(conversationId) as MessageRow[]).map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
    }));
  }

  saveExchange(
    conversationId: string,
    userContent: string,
    assistantContent: string,
  ): ConversationSummary {
    const conversation = this.getConversation(conversationId);
    if (!conversation) throw new ConversationNotFoundError(conversationId);

    const timestamp = new Date().toISOString();
    const title =
      conversation.title === NEW_CONVERSATION_TITLE
        ? (userContent.replace(/\s+/g, " ").trim().slice(0, TITLE_LENGTH) ||
          NEW_CONVERSATION_TITLE)
        : conversation.title;

    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.insertMessageStatement.run(conversationId, "user", userContent, timestamp);
      this.insertMessageStatement.run(conversationId, "assistant", assistantContent, timestamp);
      this.updateConversationStatement.run(title, timestamp, conversationId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }

    return { ...conversation, title, updatedAt: timestamp };
  }

  deleteConversation(id: string): boolean {
    return this.deleteConversationStatement.run(id).changes > 0;
  }

  close(): void {
    this.database.close();
  }
}

const globalForStore = globalThis as typeof globalThis & {
  conversationStore?: SqliteConversationStore;
};

export function getConversationStore(): SqliteConversationStore {
  globalForStore.conversationStore ??= new SqliteConversationStore(
    join(process.cwd(), "data", "chat.sqlite"),
  );
  return globalForStore.conversationStore;
}

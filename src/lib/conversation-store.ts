import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { openChatDatabase, releaseChatDatabase } from "./sqlite-database";
import type {
  ConversationSummary,
  ExchangeUsageInput,
  MessageRole,
  OverflowRun,
  OverflowRunInput,
  StoredExchangeUsage,
  StoredMessage,
} from "./conversation-types";

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

type ExchangeUsageRow = {
  id: number;
  conversation_id: string;
  assistant_message_id: number;
  model: string;
  context_limit: number;
  system_tokens: number;
  history_tokens: number;
  request_tokens: number;
  prompt_tokens: number;
  reserved_output_tokens: number;
  response_tokens: number;
  provider_prompt_tokens: number | null;
  provider_completion_tokens: number | null;
  cache_hit_tokens: number | null;
  cache_miss_tokens: number | null;
  source: "provider" | "estimated";
  tariff_band: "peak" | "off-peak";
  cost_micros_usd: number;
  created_at: string;
};

type OverflowRunRow = {
  id: number;
  model: string;
  context_limit: number;
  local_input_tokens: number;
  provider_input_tokens: number | null;
  outcome: OverflowRun["outcome"];
  http_status: number | null;
  error_message: string | null;
  duration_ms: number;
  cost_micros_usd: number;
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
  private readonly insertUsageStatement: StatementSync;
  private readonly getUsageStatement: StatementSync;
  private readonly insertOverflowRunStatement: StatementSync;
  private readonly getLatestOverflowRunStatement: StatementSync;
  private readonly updateConversationStatement: StatementSync;
  private readonly deleteConversationStatement: StatementSync;

  private readonly databasePath: string;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
    this.database = openChatDatabase(databasePath);
    this.database.exec(`

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

      CREATE TABLE IF NOT EXISTS exchange_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL
          REFERENCES conversations(id) ON DELETE CASCADE,
        assistant_message_id INTEGER NOT NULL UNIQUE
          REFERENCES messages(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        context_limit INTEGER NOT NULL CHECK (context_limit > 0),
        system_tokens INTEGER NOT NULL CHECK (system_tokens >= 0),
        history_tokens INTEGER NOT NULL CHECK (history_tokens >= 0),
        request_tokens INTEGER NOT NULL CHECK (request_tokens >= 0),
        prompt_tokens INTEGER NOT NULL CHECK (prompt_tokens >= 0),
        reserved_output_tokens INTEGER NOT NULL CHECK (reserved_output_tokens >= 0),
        response_tokens INTEGER NOT NULL CHECK (response_tokens >= 0),
        provider_prompt_tokens INTEGER CHECK (provider_prompt_tokens >= 0),
        provider_completion_tokens INTEGER CHECK (provider_completion_tokens >= 0),
        cache_hit_tokens INTEGER CHECK (cache_hit_tokens >= 0),
        cache_miss_tokens INTEGER CHECK (cache_miss_tokens >= 0),
        source TEXT NOT NULL CHECK (source IN ('provider', 'estimated')),
        tariff_band TEXT NOT NULL CHECK (tariff_band IN ('peak', 'off-peak')),
        cost_micros_usd INTEGER NOT NULL CHECK (cost_micros_usd >= 0),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS exchange_usage_conversation_created
        ON exchange_usage(conversation_id, created_at, id);

      CREATE TABLE IF NOT EXISTS overflow_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model TEXT NOT NULL,
        context_limit INTEGER NOT NULL CHECK (context_limit > 0),
        local_input_tokens INTEGER NOT NULL CHECK (local_input_tokens >= 0),
        provider_input_tokens INTEGER CHECK (provider_input_tokens >= 0),
        outcome TEXT NOT NULL
          CHECK (outcome IN ('rejected', 'truncated', 'accepted', 'network_error')),
        http_status INTEGER,
        error_message TEXT,
        duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
        cost_micros_usd INTEGER NOT NULL CHECK (cost_micros_usd >= 0),
        created_at TEXT NOT NULL
      ) STRICT;
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
    this.insertUsageStatement = this.database.prepare(`
      INSERT INTO exchange_usage (
        conversation_id,
        assistant_message_id,
        model,
        context_limit,
        system_tokens,
        history_tokens,
        request_tokens,
        prompt_tokens,
        reserved_output_tokens,
        response_tokens,
        provider_prompt_tokens,
        provider_completion_tokens,
        cache_hit_tokens,
        cache_miss_tokens,
        source,
        tariff_band,
        cost_micros_usd,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.getUsageStatement = this.database.prepare(`
      SELECT
        id,
        conversation_id,
        assistant_message_id,
        model,
        context_limit,
        system_tokens,
        history_tokens,
        request_tokens,
        prompt_tokens,
        reserved_output_tokens,
        response_tokens,
        provider_prompt_tokens,
        provider_completion_tokens,
        cache_hit_tokens,
        cache_miss_tokens,
        source,
        tariff_band,
        cost_micros_usd,
        created_at
      FROM exchange_usage
      WHERE conversation_id = ?
      ORDER BY created_at ASC, id ASC
    `);
    this.insertOverflowRunStatement = this.database.prepare(`
      INSERT INTO overflow_runs (
        model,
        context_limit,
        local_input_tokens,
        provider_input_tokens,
        outcome,
        http_status,
        error_message,
        duration_ms,
        cost_micros_usd,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.getLatestOverflowRunStatement = this.database.prepare(`
      SELECT
        id,
        model,
        context_limit,
        local_input_tokens,
        provider_input_tokens,
        outcome,
        http_status,
        error_message,
        duration_ms,
        cost_micros_usd,
        created_at
      FROM overflow_runs
      ORDER BY id DESC
      LIMIT 1
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
    usage?: ExchangeUsageInput,
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
      const assistantResult = this.insertMessageStatement.run(
        conversationId,
        "assistant",
        assistantContent,
        timestamp,
      );
      if (usage) {
        this.insertUsageStatement.run(
          conversationId,
          Number(assistantResult.lastInsertRowid),
          usage.model,
          usage.contextLimit,
          usage.systemTokens,
          usage.historyTokens,
          usage.requestTokens,
          usage.promptTokens,
          usage.reservedOutputTokens,
          usage.responseTokens,
          usage.providerUsage?.promptTokens ?? null,
          usage.providerUsage?.completionTokens ?? null,
          usage.providerUsage?.cacheHitTokens ?? null,
          usage.providerUsage?.cacheMissTokens ?? null,
          usage.source,
          usage.tariffBand,
          usage.costMicrosUsd,
          timestamp,
        );
      }
      this.updateConversationStatement.run(title, timestamp, conversationId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }

    return { ...conversation, title, updatedAt: timestamp };
  }

  getConversationUsage(conversationId: string): StoredExchangeUsage[] {
    return (this.getUsageStatement.all(conversationId) as ExchangeUsageRow[]).map(
      (row) => ({
        id: row.id,
        conversationId: row.conversation_id,
        assistantMessageId: row.assistant_message_id,
        model: row.model,
        contextLimit: row.context_limit,
        systemTokens: row.system_tokens,
        historyTokens: row.history_tokens,
        requestTokens: row.request_tokens,
        promptTokens: row.prompt_tokens,
        reservedOutputTokens: row.reserved_output_tokens,
        contextTokens: row.prompt_tokens + row.reserved_output_tokens,
        responseTokens: row.response_tokens,
        providerPromptTokens: row.provider_prompt_tokens,
        providerCompletionTokens: row.provider_completion_tokens,
        cacheHitTokens: row.cache_hit_tokens,
        cacheMissTokens: row.cache_miss_tokens,
        source: row.source,
        tariffBand: row.tariff_band,
        costMicrosUsd: row.cost_micros_usd,
        createdAt: row.created_at,
      }),
    );
  }

  saveOverflowRun(input: OverflowRunInput): OverflowRun {
    const timestamp = new Date().toISOString();
    let safeErrorMessage: string | null = null;
    if (input.errorMessage) {
      const codePoints: string[] = [];
      for (const codePoint of input.errorMessage) {
        if (codePoints.length === 500) break;
        codePoints.push(codePoint);
      }
      safeErrorMessage = codePoints.join("");
    }

    const result = this.insertOverflowRunStatement.run(
      input.model,
      input.contextLimit,
      input.localInputTokens,
      input.providerInputTokens,
      input.outcome,
      input.httpStatus,
      safeErrorMessage,
      input.durationMs,
      input.costMicrosUsd,
      timestamp,
    );

    return {
      ...input,
      id: Number(result.lastInsertRowid),
      errorMessage: safeErrorMessage,
      createdAt: timestamp,
    };
  }

  getLatestOverflowRun(): OverflowRun | null {
    const row = this.getLatestOverflowRunStatement.get() as OverflowRunRow | undefined;
    return row
      ? {
          id: row.id,
          model: row.model,
          contextLimit: row.context_limit,
          localInputTokens: row.local_input_tokens,
          providerInputTokens: row.provider_input_tokens,
          outcome: row.outcome,
          httpStatus: row.http_status,
          errorMessage: row.error_message,
          durationMs: row.duration_ms,
          costMicrosUsd: row.cost_micros_usd,
          createdAt: row.created_at,
        }
      : null;
  }

  deleteConversation(id: string): boolean {
    return this.deleteConversationStatement.run(id).changes > 0;
  }

  close(): void {
    releaseChatDatabase(this.databasePath);
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

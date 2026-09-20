import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { ensureConversationSchema } from "./conversation-schema";
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
import type {
  ExchangeCompressionInput,
  StoredExchangeCompression,
  SummaryCheckpoint,
  SummaryCheckpointInput,
} from "./compression-types";
import {
  mapSummary,
  type ExchangeCompressionRow,
  type SummaryRow,
} from "./conversation-compression-rows";

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
  private readonly getMessagesAfterStatement: StatementSync;
  private readonly insertMessageStatement: StatementSync;
  private readonly insertUsageStatement: StatementSync;
  private readonly getUsageStatement: StatementSync;
  private readonly insertSummaryStatement: StatementSync;
  private readonly getLatestSummaryStatement: StatementSync;
  private readonly getSummariesStatement: StatementSync;
  private readonly getMessageConversationStatement: StatementSync;
  private readonly countMessagesThroughStatement: StatementSync;
  private readonly getSummaryConversationStatement: StatementSync;
  private readonly insertCompressionStatement: StatementSync;
  private readonly getCompressionStatement: StatementSync;
  private readonly insertOverflowRunStatement: StatementSync;
  private readonly getLatestOverflowRunStatement: StatementSync;
  private readonly updateConversationStatement: StatementSync;
  private readonly deleteConversationStatement: StatementSync;

  private readonly databasePath: string;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
    this.database = openChatDatabase(databasePath);
    ensureConversationSchema(this.database);

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
    this.getMessagesAfterStatement = this.database.prepare(`
      SELECT id, conversation_id, role, content, created_at
      FROM messages
      WHERE conversation_id = ? AND id > ?
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
    this.insertSummaryStatement = this.database.prepare(`
      INSERT INTO conversation_summaries (
        conversation_id,
        summarized_through_message_id,
        summarized_message_count,
        content,
        model,
        provider_prompt_tokens,
        provider_completion_tokens,
        cost_micros_usd,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.getLatestSummaryStatement = this.database.prepare(`
      SELECT *
      FROM conversation_summaries
      WHERE conversation_id = ?
      ORDER BY summarized_message_count DESC, id DESC
      LIMIT 1
    `);
    this.getSummariesStatement = this.database.prepare(`
      SELECT *
      FROM conversation_summaries
      WHERE conversation_id = ?
      ORDER BY summarized_message_count ASC, id ASC
    `);
    this.getMessageConversationStatement = this.database.prepare(`
      SELECT conversation_id
      FROM messages
      WHERE id = ?
    `);
    this.countMessagesThroughStatement = this.database.prepare(`
      SELECT COUNT(*) AS message_count
      FROM messages
      WHERE conversation_id = ? AND id <= ?
    `);
    this.getSummaryConversationStatement = this.database.prepare(`
      SELECT conversation_id
      FROM conversation_summaries
      WHERE id = ?
    `);
    this.insertCompressionStatement = this.database.prepare(`
      INSERT INTO exchange_compression (
        assistant_message_id,
        conversation_id,
        summary_id,
        raw_tail_message_count,
        full_prompt_tokens,
        compressed_prompt_tokens,
        summary_tokens,
        raw_tail_tokens,
        gross_saved_tokens,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.getCompressionStatement = this.database.prepare(`
      SELECT
        ec.*,
        eu.provider_prompt_tokens,
        eu.provider_completion_tokens,
        eu.request_tokens,
        eu.response_tokens,
        eu.source,
        eu.cost_micros_usd
      FROM exchange_compression AS ec
      LEFT JOIN exchange_usage AS eu
        ON eu.assistant_message_id = ec.assistant_message_id
      WHERE ec.conversation_id = ?
      ORDER BY ec.created_at ASC, ec.assistant_message_id ASC
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

  getMessagesAfter(
    conversationId: string,
    summarizedThroughMessageId: number | null,
  ): StoredMessage[] {
    return (
      this.getMessagesAfterStatement.all(
        conversationId,
        summarizedThroughMessageId ?? 0,
      ) as MessageRow[]
    ).map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
    }));
  }

  getLatestConversationSummary(conversationId: string): SummaryCheckpoint | null {
    const row = this.getLatestSummaryStatement.get(conversationId) as
      | SummaryRow
      | undefined;
    return row ? mapSummary(row) : null;
  }

  getConversationSummaries(conversationId: string): SummaryCheckpoint[] {
    return (this.getSummariesStatement.all(conversationId) as SummaryRow[]).map(
      mapSummary,
    );
  }

  saveConversationSummary(
    conversationId: string,
    input: SummaryCheckpointInput,
  ): SummaryCheckpoint {
    if (!this.getConversation(conversationId)) {
      throw new ConversationNotFoundError(conversationId);
    }
    const content = input.content.trim();
    if (
      !content ||
      !input.model.trim() ||
      input.providerPromptTokens === null ||
      input.providerCompletionTokens === null
    ) {
      throw new TypeError("Summary и его provider usage обязательны.");
    }

    const timestamp = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const cursor = this.getMessageConversationStatement.get(
        input.summarizedThroughMessageId,
      ) as { conversation_id: string } | undefined;
      if (cursor?.conversation_id !== conversationId) {
        throw new RangeError("Summary cursor не принадлежит диалогу.");
      }
      const latest = this.getLatestSummaryStatement.get(conversationId) as
        | SummaryRow
        | undefined;
      const expectedCount =
        (latest?.summarized_message_count ?? 0) + 10;
      const countRow = this.countMessagesThroughStatement.get(
        conversationId,
        input.summarizedThroughMessageId,
      ) as { message_count: number };
      if (
        input.summarizedMessageCount !== expectedCount ||
        countRow.message_count !== input.summarizedMessageCount
      ) {
        throw new RangeError("Summary checkpoint пропускает сообщения.");
      }
      const result = this.insertSummaryStatement.run(
        conversationId,
        input.summarizedThroughMessageId,
        input.summarizedMessageCount,
        content,
        input.model,
        input.providerPromptTokens,
        input.providerCompletionTokens,
        input.costMicrosUsd,
        timestamp,
      );
      this.database.exec("COMMIT");
      return {
        ...input,
        id: Number(result.lastInsertRowid),
        conversationId,
        content,
        createdAt: timestamp,
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getConversationCompression(
    conversationId: string,
  ): StoredExchangeCompression[] {
    return (
      this.getCompressionStatement.all(conversationId) as ExchangeCompressionRow[]
    ).map((row) => {
      if (
        row.source === null ||
        row.cost_micros_usd === null ||
        row.request_tokens === null ||
        row.response_tokens === null
      ) {
        throw new Error("Compression row не связан с exchange usage.");
      }
      return {
        assistantMessageId: row.assistant_message_id,
        conversationId: row.conversation_id,
        requestTokens: row.request_tokens,
        responseTokens: row.response_tokens,
        summaryId: row.summary_id,
        rawTailMessageCount: row.raw_tail_message_count,
        fullPromptTokens: row.full_prompt_tokens,
        compressedPromptTokens: row.compressed_prompt_tokens,
        summaryTokens: row.summary_tokens,
        rawTailTokens: row.raw_tail_tokens,
        grossSavedTokens: row.gross_saved_tokens,
        providerPromptTokens: row.provider_prompt_tokens,
        providerCompletionTokens: row.provider_completion_tokens,
        source: row.source,
        costMicrosUsd: row.cost_micros_usd,
        createdAt: row.created_at,
      };
    });
  }

  saveExchange(
    conversationId: string,
    userContent: string,
    assistantContent: string,
    usage?: ExchangeUsageInput,
    compression?: ExchangeCompressionInput,
  ): ConversationSummary {
    const conversation = this.getConversation(conversationId);
    if (!conversation) throw new ConversationNotFoundError(conversationId);
    if (compression && !usage) {
      throw new TypeError("Compression metrics требуют exchange usage.");
    }

    const timestamp = new Date().toISOString();
    const title =
      conversation.title === NEW_CONVERSATION_TITLE
        ? (userContent.replace(/\s+/g, " ").trim().slice(0, TITLE_LENGTH) ||
          NEW_CONVERSATION_TITLE)
        : conversation.title;

    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (compression?.summaryId !== null && compression?.summaryId !== undefined) {
        const summary = this.getSummaryConversationStatement.get(
          compression.summaryId,
        ) as { conversation_id: string } | undefined;
        if (summary?.conversation_id !== conversationId) {
          throw new RangeError("Compression summary не принадлежит диалогу.");
        }
      }
      this.insertMessageStatement.run(conversationId, "user", userContent, timestamp);
      const assistantResult = this.insertMessageStatement.run(
        conversationId,
        "assistant",
        assistantContent,
        timestamp,
      );
      const assistantMessageId = Number(assistantResult.lastInsertRowid);
      if (usage) {
        this.insertUsageStatement.run(
          conversationId,
          assistantMessageId,
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
      if (compression) {
        this.insertCompressionStatement.run(
          assistantMessageId,
          conversationId,
          compression.summaryId,
          compression.rawTailMessageCount,
          compression.fullPromptTokens,
          compression.compressedPromptTokens,
          compression.summaryTokens,
          compression.rawTailTokens,
          compression.grossSavedTokens,
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

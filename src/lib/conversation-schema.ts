import type { DatabaseSync } from "node:sqlite";

const CONVERSATION_SCHEMA = `

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

      CREATE TABLE IF NOT EXISTS conversation_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL
          REFERENCES conversations(id) ON DELETE CASCADE,
        summarized_through_message_id INTEGER NOT NULL
          REFERENCES messages(id) ON DELETE CASCADE,
        summarized_message_count INTEGER NOT NULL
          CHECK (
            summarized_message_count > 0
            AND summarized_message_count % 10 = 0
          ),
        content TEXT NOT NULL CHECK (length(content) > 0),
        model TEXT NOT NULL,
        provider_prompt_tokens INTEGER CHECK (provider_prompt_tokens >= 0),
        provider_completion_tokens INTEGER CHECK (provider_completion_tokens >= 0),
        cost_micros_usd INTEGER NOT NULL CHECK (cost_micros_usd >= 0),
        created_at TEXT NOT NULL,
        UNIQUE (conversation_id, summarized_through_message_id)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS conversation_summaries_latest
        ON conversation_summaries(
          conversation_id,
          summarized_message_count DESC,
          id DESC
        );

      CREATE TABLE IF NOT EXISTS exchange_compression (
        assistant_message_id INTEGER PRIMARY KEY
          REFERENCES messages(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL
          REFERENCES conversations(id) ON DELETE CASCADE,
        summary_id INTEGER
          REFERENCES conversation_summaries(id) ON DELETE SET NULL,
        raw_tail_message_count INTEGER NOT NULL
          CHECK (raw_tail_message_count BETWEEN 0 AND 19),
        full_prompt_tokens INTEGER NOT NULL CHECK (full_prompt_tokens >= 0),
        compressed_prompt_tokens INTEGER NOT NULL
          CHECK (compressed_prompt_tokens >= 0),
        summary_tokens INTEGER NOT NULL CHECK (summary_tokens >= 0),
        raw_tail_tokens INTEGER NOT NULL CHECK (raw_tail_tokens >= 0),
        gross_saved_tokens INTEGER NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS exchange_compression_conversation_created
        ON exchange_compression(
          conversation_id,
          created_at,
          assistant_message_id
        );

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
`;

/**
 * Создаёт таблицы диалогов, сообщений и метрик Day 7–10. Модули памяти ссылаются
 * на них внешними ключами, поэтому схема гарантируется до создания их таблиц.
 */
export function ensureConversationSchema(database: DatabaseSync): void {
  database.exec(CONVERSATION_SCHEMA);
}

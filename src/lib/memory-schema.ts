import type { DatabaseSync } from "node:sqlite";

import { ensureConversationSchema } from "./conversation-schema";

export const DEFAULT_PROFILE_NAME = "Основной";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS memory_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    role TEXT,
    tone TEXT NOT NULL CHECK (tone IN ('neutral', 'friendly', 'formal', 'direct')),
    verbosity TEXT NOT NULL CHECK (verbosity IN ('brief', 'balanced', 'detailed')),
    format TEXT NOT NULL CHECK (format IN ('prose', 'bullets', 'table', 'code_first')),
    language TEXT NOT NULL CHECK (language IN ('ru', 'en', 'auto')),
    expertise TEXT NOT NULL
      CHECK (expertise IN ('beginner', 'intermediate', 'expert')),
    active INTEGER NOT NULL CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE UNIQUE INDEX IF NOT EXISTS memory_profiles_active
    ON memory_profiles(active) WHERE active = 1;

  CREATE TABLE IF NOT EXISTS memory_profile_constraints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL REFERENCES memory_profiles(id) ON DELETE CASCADE,
    value TEXT NOT NULL,
    origin TEXT NOT NULL CHECK (origin IN ('router', 'user')),
    reason TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (profile_id, value)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS memory_long_term (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL REFERENCES memory_profiles(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('profile', 'decision', 'knowledge')),
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    origin TEXT NOT NULL CHECK (origin IN ('router', 'user')),
    reason TEXT,
    source_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (profile_id, kind, key)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS memory_working_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL
      REFERENCES conversations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    goal TEXT,
    status TEXT NOT NULL CHECK (status IN ('active', 'closed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE UNIQUE INDEX IF NOT EXISTS memory_working_tasks_active
    ON memory_working_tasks(conversation_id) WHERE status = 'active';

  CREATE TABLE IF NOT EXISTS memory_working_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL
      REFERENCES memory_working_tasks(id) ON DELETE CASCADE,
    kind TEXT NOT NULL
      CHECK (kind IN ('fact', 'constraint', 'step', 'open_question')),
    value TEXT NOT NULL,
    origin TEXT NOT NULL CHECK (origin IN ('router', 'user')),
    reason TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (task_id, kind, value)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS memory_writes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
    assistant_message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
    layer TEXT NOT NULL CHECK (layer IN ('working', 'long_term', 'profile')),
    kind TEXT NOT NULL,
    key TEXT,
    value TEXT NOT NULL,
    reason TEXT,
    origin TEXT NOT NULL CHECK (origin IN ('router', 'user')),
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS memory_writes_conversation
    ON memory_writes(conversation_id, id);

  CREATE TABLE IF NOT EXISTS memory_exchange_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL
      REFERENCES conversations(id) ON DELETE CASCADE,
    assistant_message_id INTEGER NOT NULL UNIQUE
      REFERENCES messages(id) ON DELETE CASCADE,
    system_tokens INTEGER NOT NULL CHECK (system_tokens >= 0),
    profile_tokens INTEGER NOT NULL DEFAULT 0 CHECK (profile_tokens >= 0),
    task_tokens INTEGER NOT NULL DEFAULT 0 CHECK (task_tokens >= 0),
    long_term_tokens INTEGER NOT NULL CHECK (long_term_tokens >= 0),
    working_tokens INTEGER NOT NULL CHECK (working_tokens >= 0),
    short_term_tokens INTEGER NOT NULL CHECK (short_term_tokens >= 0),
    request_tokens INTEGER NOT NULL CHECK (request_tokens >= 0),
    prompt_tokens INTEGER NOT NULL CHECK (prompt_tokens >= 0),
    reserved_output_tokens INTEGER NOT NULL CHECK (reserved_output_tokens >= 0),
    context_limit INTEGER NOT NULL CHECK (context_limit > 0),
    short_term_messages INTEGER NOT NULL CHECK (short_term_messages >= 0),
    layers_enabled TEXT NOT NULL,
    router_prompt_tokens INTEGER CHECK (router_prompt_tokens >= 0),
    router_completion_tokens INTEGER CHECK (router_completion_tokens >= 0),
    router_cost_micros_usd INTEGER CHECK (router_cost_micros_usd >= 0),
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS task_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL REFERENCES memory_profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    goal TEXT,
    stage TEXT NOT NULL CHECK (
      stage IN ('planning', 'execution', 'validation', 'done', 'blocked', 'cancelled')
    ),
    paused INTEGER NOT NULL CHECK (paused IN (0, 1)),
    expected_actor TEXT NOT NULL CHECK (expected_actor IN ('agent', 'user')),
    expected_action TEXT NOT NULL,
    blocked_from TEXT CHECK (
      blocked_from IN ('planning', 'execution', 'validation')
    ),
    blocked_reason TEXT,
    current_step_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE UNIQUE INDEX IF NOT EXISTS task_runs_live
    ON task_runs(profile_id)
    WHERE stage IN ('planning', 'execution', 'validation', 'blocked');

  CREATE TABLE IF NOT EXISTS task_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position > 0),
    title TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'done', 'skipped')),
    result TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (run_id, position)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL
      CHECK (kind IN ('transition', 'step', 'pause', 'resume', 'rejected')),
    origin TEXT NOT NULL CHECK (origin IN ('agent', 'user')),
    from_stage TEXT,
    to_stage TEXT,
    reason TEXT,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
    assistant_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS task_events_run ON task_events(run_id, id);
`;

type ColumnRow = { name: string };
type TableSqlRow = { sql: string };

function tableColumns(database: DatabaseSync, table: string): string[] {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as ColumnRow[];
  return rows.map((row) => row.name);
}

/**
 * Переносит долговременную память Day 11 под профили: STRICT-таблицу нельзя
 * изменить на месте, поэтому старые записи переливаются в профиль по умолчанию.
 */
function migrateLongTermToProfiles(database: DatabaseSync, defaultProfileId: number): void {
  database.exec(`
    ALTER TABLE memory_long_term RENAME TO memory_long_term_legacy;

    CREATE TABLE memory_long_term (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES memory_profiles(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('profile', 'decision', 'knowledge')),
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      origin TEXT NOT NULL CHECK (origin IN ('router', 'user')),
      reason TEXT,
      source_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (profile_id, kind, key)
    ) STRICT;

    INSERT INTO memory_long_term (
      id, profile_id, kind, key, value, origin, reason, source_conversation_id,
      created_at, updated_at
    )
    SELECT id, ${defaultProfileId}, kind, key, value, origin, reason,
           source_conversation_id, created_at, updated_at
    FROM memory_long_term_legacy;

    DROP TABLE memory_long_term_legacy;
  `);
}

/** Расширяет журнал записей слоем профиля, сохраняя историю Day 11. */
function migrateWritesWithProfileLayer(database: DatabaseSync): void {
  database.exec(`
    ALTER TABLE memory_writes RENAME TO memory_writes_legacy;

    CREATE TABLE memory_writes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
      assistant_message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
      layer TEXT NOT NULL CHECK (layer IN ('working', 'long_term', 'profile')),
      kind TEXT NOT NULL,
      key TEXT,
      value TEXT NOT NULL,
      reason TEXT,
      origin TEXT NOT NULL CHECK (origin IN ('router', 'user')),
      created_at TEXT NOT NULL
    ) STRICT;

    INSERT INTO memory_writes (
      id, conversation_id, assistant_message_id, layer, kind, key, value, reason,
      origin, created_at
    )
    SELECT id, conversation_id, assistant_message_id, layer, kind, key, value,
           reason, origin, created_at
    FROM memory_writes_legacy;

    DROP TABLE memory_writes_legacy;

    CREATE INDEX IF NOT EXISTS memory_writes_conversation
      ON memory_writes(conversation_id, id);
  `);
}

/**
 * Создаёт схему памяти и выполняет идемпотентные миграции Day 11 → Day 12.
 * Вызывается каждым хранилищем памяти, поэтому безопасна при повторах.
 */
export function ensureMemorySchema(database: DatabaseSync): void {
  ensureConversationSchema(database);
  database.exec(SCHEMA);

  const timestamp = new Date().toISOString();
  database.exec("BEGIN IMMEDIATE");
  try {
    const profileCount = database
      .prepare("SELECT COUNT(*) AS count FROM memory_profiles")
      .get() as { count: number };
    if (profileCount.count === 0) {
      database
        .prepare(
          `INSERT INTO memory_profiles (
            name, role, tone, verbosity, format, language, expertise, active,
            created_at, updated_at
          ) VALUES (?, NULL, 'neutral', 'balanced', 'prose', 'ru', 'intermediate', 1, ?, ?)`,
        )
        .run(DEFAULT_PROFILE_NAME, timestamp, timestamp);
    }

    const activeProfile = database
      .prepare("SELECT id FROM memory_profiles WHERE active = 1")
      .get() as { id: number } | undefined;
    const fallbackProfile =
      activeProfile ??
      (database.prepare("SELECT id FROM memory_profiles ORDER BY id ASC").get() as {
        id: number;
      });
    if (!activeProfile) {
      database
        .prepare("UPDATE memory_profiles SET active = 1, updated_at = ? WHERE id = ?")
        .run(timestamp, fallbackProfile.id);
    }

    if (!tableColumns(database, "memory_long_term").includes("profile_id")) {
      migrateLongTermToProfiles(database, fallbackProfile.id);
    }

    const writesSql = database
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory_writes'")
      .get() as TableSqlRow | undefined;
    if (writesSql && !writesSql.sql.includes("'profile'")) {
      migrateWritesWithProfileLayer(database);
    }

    const usageColumns = tableColumns(database, "memory_exchange_usage");
    if (!usageColumns.includes("profile_tokens")) {
      database.exec(
        `ALTER TABLE memory_exchange_usage
           ADD COLUMN profile_tokens INTEGER NOT NULL DEFAULT 0 CHECK (profile_tokens >= 0)`,
      );
    }
    if (!usageColumns.includes("task_tokens")) {
      database.exec(
        `ALTER TABLE memory_exchange_usage
           ADD COLUMN task_tokens INTEGER NOT NULL DEFAULT 0 CHECK (task_tokens >= 0)`,
      );
    }

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

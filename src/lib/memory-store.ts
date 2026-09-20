import { join } from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";

import { openChatDatabase, releaseChatDatabase } from "./sqlite-database";
import type {
  ConversationMemorySnapshot,
  LongTermEntry,
  LongTermInput,
  LongTermKind,
  MemoryExchangeUsage,
  MemoryExchangeUsageInput,
  MemoryOrigin,
  MemoryRouterResult,
  MemoryWrite,
  WorkingMemory,
  WorkingSlot,
  WorkingSlotInput,
  WorkingSlotKind,
  WorkingTask,
  WorkingTaskInput,
  WorkingTaskStatus,
} from "./memory-types";

const WRITE_LOG_LIMIT = 40;

type LongTermRow = {
  id: number;
  kind: LongTermKind;
  key: string;
  value: string;
  origin: MemoryOrigin;
  reason: string | null;
  source_conversation_id: string | null;
  created_at: string;
  updated_at: string;
};

type TaskRow = {
  id: number;
  conversation_id: string;
  title: string;
  goal: string | null;
  status: WorkingTaskStatus;
  created_at: string;
  updated_at: string;
};

type SlotRow = {
  id: number;
  task_id: number;
  kind: WorkingSlotKind;
  value: string;
  origin: MemoryOrigin;
  reason: string | null;
  created_at: string;
};

type WriteRow = {
  id: number;
  conversation_id: string | null;
  assistant_message_id: number | null;
  layer: "working" | "long_term";
  kind: string;
  key: string | null;
  value: string;
  reason: string | null;
  origin: MemoryOrigin;
  created_at: string;
};

type UsageRow = {
  id: number;
  conversation_id: string;
  assistant_message_id: number;
  system_tokens: number;
  long_term_tokens: number;
  working_tokens: number;
  short_term_tokens: number;
  request_tokens: number;
  prompt_tokens: number;
  reserved_output_tokens: number;
  context_limit: number;
  short_term_messages: number;
  layers_enabled: string;
  router_prompt_tokens: number | null;
  router_completion_tokens: number | null;
  router_cost_micros_usd: number | null;
  created_at: string;
};

function toLongTermEntry(row: LongTermRow): LongTermEntry {
  return {
    id: row.id,
    kind: row.kind,
    key: row.key,
    value: row.value,
    origin: row.origin,
    reason: row.reason,
    sourceConversationId: row.source_conversation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTask(row: TaskRow): WorkingTask {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    title: row.title,
    goal: row.goal,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteMemoryStore {
  private readonly database: DatabaseSync;
  private readonly databasePath: string;
  private readonly listLongTermStatement: StatementSync;
  private readonly upsertLongTermStatement: StatementSync;
  private readonly deleteLongTermStatement: StatementSync;
  private readonly getActiveTaskStatement: StatementSync;
  private readonly insertTaskStatement: StatementSync;
  private readonly updateTaskStatement: StatementSync;
  private readonly closeTaskStatement: StatementSync;
  private readonly listSlotsStatement: StatementSync;
  private readonly insertSlotStatement: StatementSync;
  private readonly deleteSlotStatement: StatementSync;
  private readonly insertWriteStatement: StatementSync;
  private readonly listWritesStatement: StatementSync;
  private readonly insertUsageStatement: StatementSync;
  private readonly getLatestUsageStatement: StatementSync;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
    this.database = openChatDatabase(databasePath);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS memory_long_term (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('profile', 'decision', 'knowledge')),
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        origin TEXT NOT NULL CHECK (origin IN ('router', 'user')),
        reason TEXT,
        source_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (kind, key)
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
        layer TEXT NOT NULL CHECK (layer IN ('working', 'long_term')),
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
    `);

    this.listLongTermStatement = this.database.prepare(`
      SELECT id, kind, key, value, origin, reason, source_conversation_id,
             created_at, updated_at
      FROM memory_long_term
      ORDER BY updated_at DESC, id DESC
    `);
    this.upsertLongTermStatement = this.database.prepare(`
      INSERT INTO memory_long_term (
        kind, key, value, origin, reason, source_conversation_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (kind, key) DO UPDATE SET
        value = excluded.value,
        origin = excluded.origin,
        reason = excluded.reason,
        source_conversation_id = excluded.source_conversation_id,
        updated_at = excluded.updated_at
      RETURNING id, kind, key, value, origin, reason, source_conversation_id,
                created_at, updated_at
    `);
    this.deleteLongTermStatement = this.database.prepare(`
      DELETE FROM memory_long_term WHERE id = ?
    `);
    this.getActiveTaskStatement = this.database.prepare(`
      SELECT id, conversation_id, title, goal, status, created_at, updated_at
      FROM memory_working_tasks
      WHERE conversation_id = ? AND status = 'active'
    `);
    this.insertTaskStatement = this.database.prepare(`
      INSERT INTO memory_working_tasks (
        conversation_id, title, goal, status, created_at, updated_at
      ) VALUES (?, ?, ?, 'active', ?, ?)
      RETURNING id, conversation_id, title, goal, status, created_at, updated_at
    `);
    this.updateTaskStatement = this.database.prepare(`
      UPDATE memory_working_tasks
      SET title = ?, goal = ?, updated_at = ?
      WHERE id = ?
      RETURNING id, conversation_id, title, goal, status, created_at, updated_at
    `);
    this.closeTaskStatement = this.database.prepare(`
      UPDATE memory_working_tasks
      SET status = 'closed', updated_at = ?
      WHERE conversation_id = ? AND status = 'active'
      RETURNING id, conversation_id, title, goal, status, created_at, updated_at
    `);
    this.listSlotsStatement = this.database.prepare(`
      SELECT id, task_id, kind, value, origin, reason, created_at
      FROM memory_working_slots
      WHERE task_id = ?
      ORDER BY id ASC
    `);
    this.insertSlotStatement = this.database.prepare(`
      INSERT INTO memory_working_slots (task_id, kind, value, origin, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (task_id, kind, value) DO NOTHING
      RETURNING id, task_id, kind, value, origin, reason, created_at
    `);
    this.deleteSlotStatement = this.database.prepare(`
      DELETE FROM memory_working_slots
      WHERE id = ? AND task_id IN (
        SELECT id FROM memory_working_tasks WHERE conversation_id = ?
      )
    `);
    this.insertWriteStatement = this.database.prepare(`
      INSERT INTO memory_writes (
        conversation_id, assistant_message_id, layer, kind, key, value, reason,
        origin, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.listWritesStatement = this.database.prepare(`
      SELECT id, conversation_id, assistant_message_id, layer, kind, key, value,
             reason, origin, created_at
      FROM memory_writes
      WHERE conversation_id = ?
      ORDER BY id DESC
      LIMIT ?
    `);
    this.insertUsageStatement = this.database.prepare(`
      INSERT INTO memory_exchange_usage (
        conversation_id, assistant_message_id, system_tokens, long_term_tokens,
        working_tokens, short_term_tokens, request_tokens, prompt_tokens,
        reserved_output_tokens, context_limit, short_term_messages, layers_enabled,
        router_prompt_tokens, router_completion_tokens, router_cost_micros_usd,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.getLatestUsageStatement = this.database.prepare(`
      SELECT id, conversation_id, assistant_message_id, system_tokens,
             long_term_tokens, working_tokens, short_term_tokens, request_tokens,
             prompt_tokens, reserved_output_tokens, context_limit,
             short_term_messages, layers_enabled, router_prompt_tokens,
             router_completion_tokens, router_cost_micros_usd, created_at
      FROM memory_exchange_usage
      WHERE conversation_id = ?
      ORDER BY id DESC
      LIMIT 1
    `);
  }

  listLongTerm(): LongTermEntry[] {
    return (this.listLongTermStatement.all() as LongTermRow[]).map(toLongTermEntry);
  }

  upsertLongTerm(input: LongTermInput, journal?: JournalContext): LongTermEntry {
    const timestamp = new Date().toISOString();
    const row = this.upsertLongTermStatement.get(
      input.kind,
      input.key,
      input.value,
      input.origin,
      input.reason,
      input.sourceConversationId,
      timestamp,
      timestamp,
    ) as LongTermRow;

    if (journal) {
      this.insertWriteStatement.run(
        journal.conversationId,
        journal.assistantMessageId,
        "long_term",
        input.kind,
        input.key,
        input.value,
        input.reason,
        input.origin,
        timestamp,
      );
    }

    return toLongTermEntry(row);
  }

  deleteLongTerm(id: number): boolean {
    return this.deleteLongTermStatement.run(id).changes > 0;
  }

  getActiveTask(conversationId: string): WorkingTask | null {
    const row = this.getActiveTaskStatement.get(conversationId) as TaskRow | undefined;
    return row ? toTask(row) : null;
  }

  getWorkingMemory(conversationId: string): WorkingMemory | null {
    const task = this.getActiveTask(conversationId);
    if (!task) return null;

    const slots = (this.listSlotsStatement.all(task.id) as SlotRow[]).map((row) => ({
      id: row.id,
      taskId: row.task_id,
      kind: row.kind,
      value: row.value,
      origin: row.origin,
      reason: row.reason,
      createdAt: row.created_at,
    }));

    return { task, slots };
  }

  upsertActiveTask(conversationId: string, input: WorkingTaskInput): WorkingTask {
    const timestamp = new Date().toISOString();
    const existing = this.getActiveTask(conversationId);
    const row = existing
      ? (this.updateTaskStatement.get(
          input.title,
          input.goal,
          timestamp,
          existing.id,
        ) as TaskRow)
      : (this.insertTaskStatement.get(
          conversationId,
          input.title,
          input.goal,
          timestamp,
          timestamp,
        ) as TaskRow);

    return toTask(row);
  }

  closeActiveTask(conversationId: string): WorkingTask | null {
    const row = this.closeTaskStatement.get(new Date().toISOString(), conversationId) as
      | TaskRow
      | undefined;
    return row ? toTask(row) : null;
  }

  addSlot(
    taskId: number,
    input: WorkingSlotInput,
    journal?: JournalContext,
  ): WorkingSlot | null {
    const timestamp = new Date().toISOString();
    const row = this.insertSlotStatement.get(
      taskId,
      input.kind,
      input.value,
      input.origin,
      input.reason,
      timestamp,
    ) as SlotRow | undefined;
    if (!row) return null;

    if (journal) {
      this.insertWriteStatement.run(
        journal.conversationId,
        journal.assistantMessageId,
        "working",
        input.kind,
        null,
        input.value,
        input.reason,
        input.origin,
        timestamp,
      );
    }

    return {
      id: row.id,
      taskId: row.task_id,
      kind: row.kind,
      value: row.value,
      origin: row.origin,
      reason: row.reason,
      createdAt: row.created_at,
    };
  }

  deleteSlot(conversationId: string, slotId: number): boolean {
    return this.deleteSlotStatement.run(slotId, conversationId).changes > 0;
  }

  listWrites(conversationId: string, limit: number = WRITE_LOG_LIMIT): MemoryWrite[] {
    return (this.listWritesStatement.all(conversationId, limit) as WriteRow[]).map(
      (row) => ({
        id: row.id,
        conversationId: row.conversation_id ?? conversationId,
        assistantMessageId: row.assistant_message_id,
        layer: row.layer,
        kind: row.kind as MemoryWrite["kind"],
        key: row.key,
        value: row.value,
        reason: row.reason,
        origin: row.origin,
        createdAt: row.created_at,
      }),
    );
  }

  saveExchangeMemoryUsage(
    conversationId: string,
    assistantMessageId: number,
    usage: MemoryExchangeUsageInput,
  ): void {
    const enabled = [
      usage.layers.shortTerm ? "stm" : null,
      usage.layers.working ? "wm" : null,
      usage.layers.longTerm ? "ltm" : null,
    ]
      .filter((layer): layer is string => layer !== null)
      .join(",");

    this.insertUsageStatement.run(
      conversationId,
      assistantMessageId,
      usage.systemTokens,
      usage.longTermTokens,
      usage.workingTokens,
      usage.shortTermTokens,
      usage.requestTokens,
      usage.promptTokens,
      usage.reservedOutputTokens,
      usage.contextLimit,
      usage.shortTermMessages,
      enabled,
      usage.router?.promptTokens ?? null,
      usage.router?.completionTokens ?? null,
      usage.router?.costMicrosUsd ?? null,
      new Date().toISOString(),
    );
  }

  getLatestUsage(conversationId: string): MemoryExchangeUsage | null {
    const row = this.getLatestUsageStatement.get(conversationId) as UsageRow | undefined;
    if (!row) return null;

    const enabled = row.layers_enabled.split(",");
    return {
      id: row.id,
      conversationId: row.conversation_id,
      assistantMessageId: row.assistant_message_id,
      systemTokens: row.system_tokens,
      longTermTokens: row.long_term_tokens,
      workingTokens: row.working_tokens,
      shortTermTokens: row.short_term_tokens,
      requestTokens: row.request_tokens,
      promptTokens: row.prompt_tokens,
      reservedOutputTokens: row.reserved_output_tokens,
      contextTokens: row.prompt_tokens + row.reserved_output_tokens,
      contextLimit: row.context_limit,
      shortTermMessages: row.short_term_messages,
      layers: {
        shortTerm: enabled.includes("stm"),
        working: enabled.includes("wm"),
        longTerm: enabled.includes("ltm"),
      },
      router:
        row.router_prompt_tokens === null ||
        row.router_completion_tokens === null ||
        row.router_cost_micros_usd === null
          ? null
          : {
              promptTokens: row.router_prompt_tokens,
              completionTokens: row.router_completion_tokens,
              costMicrosUsd: row.router_cost_micros_usd,
            },
      createdAt: row.created_at,
    };
  }

  /**
   * Применяет решение роутера одной транзакцией: обновление задачи, записи в
   * слои и журнал. Возвращает число реально сохранённых записей.
   */
  applyRouterResult(
    conversationId: string,
    assistantMessageId: number,
    result: MemoryRouterResult,
  ): number {
    let applied = 0;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (result.task) this.upsertActiveTask(conversationId, result.task);

      const workingWrites = result.writes.filter((write) => write.layer === "working");
      const task = workingWrites.length > 0 ? this.getActiveTask(conversationId) : null;

      for (const write of result.writes) {
        if (write.layer === "long_term") {
          this.upsertLongTerm(
            {
              kind: write.kind,
              key: write.key,
              value: write.value,
              origin: "router",
              reason: write.reason,
              sourceConversationId: conversationId,
            },
            { conversationId, assistantMessageId },
          );
          applied += 1;
          continue;
        }

        if (!task) continue;
        const slot = this.addSlot(
          task.id,
          {
            kind: write.kind,
            value: write.value,
            origin: "router",
            reason: write.reason,
          },
          { conversationId, assistantMessageId },
        );
        if (slot) applied += 1;
      }

      if (result.closeTask) this.closeActiveTask(conversationId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }

    return applied;
  }

  getSnapshot(
    conversationId: string,
    shortTerm: ConversationMemorySnapshot["shortTerm"],
  ): ConversationMemorySnapshot {
    return {
      conversationId,
      longTerm: this.listLongTerm(),
      working: this.getWorkingMemory(conversationId),
      shortTerm,
      writes: this.listWrites(conversationId),
      latestUsage: this.getLatestUsage(conversationId),
    };
  }

  close(): void {
    releaseChatDatabase(this.databasePath);
  }
}

type JournalContext = {
  conversationId: string;
  assistantMessageId: number | null;
};

const globalForMemoryStore = globalThis as typeof globalThis & {
  memoryStore?: SqliteMemoryStore;
};

export function getMemoryStore(): SqliteMemoryStore {
  globalForMemoryStore.memoryStore ??= new SqliteMemoryStore(
    join(process.cwd(), "data", "chat.sqlite"),
  );
  return globalForMemoryStore.memoryStore;
}

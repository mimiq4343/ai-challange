import "server-only";

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  EMPTY_STICKY_FACTS,
  WINDOW_MESSAGES,
} from "./context-strategy-policy";
import type {
  ContextBenchmarkRun,
  ContextBenchmarkRunInput,
  ContextBranch,
  ContextCheckpoint,
  ContextExchangeMetrics,
  ContextSession,
  ContextSessionDetail,
  ContextStoredMessage,
  ContextStrategy,
  StickyFacts,
} from "./context-strategy-types";

export class ContextSessionNotFoundError extends Error {
  constructor(readonly sessionId: string) {
    super(`Day 10 session ${sessionId} не найдена.`);
    this.name = "ContextSessionNotFoundError";
  }
}

export class ContextStrategyStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextStrategyStateError";
  }
}

type SessionRow = {
  id: string;
  strategy: ContextStrategy;
  title: string;
  facts_json: string | null;
  active_branch_id: string | null;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: number;
  session_id: string;
  branch_id: string | null;
  role: "user" | "assistant";
  content: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost_micros_usd: number | null;
  created_at: string;
};

type CheckpointRow = {
  id: string;
  session_id: string;
  message_id: number;
  created_at: string;
};

type BranchRow = {
  id: string;
  session_id: string;
  checkpoint_id: string;
  name: string;
  created_at: string;
};

type BenchmarkRow = {
  id: number;
  model: string;
  results_json: string;
  created_at: string;
};

const STRATEGY_TITLES: Record<ContextStrategy, string> = {
  sliding: "Sliding Window",
  facts: "Sticky Facts",
  branching: "Branching",
};

function mapSession(row: SessionRow): ContextSession {
  return {
    id: row.id,
    strategy: row.strategy,
    title: row.title,
    facts: row.facts_json ? (JSON.parse(row.facts_json) as StickyFacts) : null,
    activeBranchId: row.active_branch_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row: MessageRow): ContextStoredMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    branchId: row.branch_id,
    role: row.role,
    content: row.content,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    costMicrosUsd: row.cost_micros_usd,
    createdAt: row.created_at,
  };
}

function mapCheckpoint(row: CheckpointRow): ContextCheckpoint {
  return {
    id: row.id,
    sessionId: row.session_id,
    messageId: row.message_id,
    createdAt: row.created_at,
  };
}

function mapBranch(row: BranchRow): ContextBranch {
  return {
    id: row.id,
    sessionId: row.session_id,
    checkpointId: row.checkpoint_id,
    name: row.name,
    createdAt: row.created_at,
  };
}

export class SqliteContextStrategyStore {
  private readonly db: DatabaseSync;

  constructor(
    path = process.env.CHAT_DATABASE_PATH ?? join(process.cwd(), "data", "chat.sqlite"),
  ) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS context_sessions (
        id TEXT PRIMARY KEY,
        strategy TEXT NOT NULL CHECK (strategy IN ('sliding', 'facts', 'branching')),
        title TEXT NOT NULL,
        facts_json TEXT,
        active_branch_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS context_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES context_sessions(id) ON DELETE CASCADE,
        branch_id TEXT,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL CHECK (length(content) > 0),
        prompt_tokens INTEGER CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0),
        completion_tokens INTEGER CHECK (completion_tokens IS NULL OR completion_tokens >= 0),
        cost_micros_usd INTEGER CHECK (cost_micros_usd IS NULL OR cost_micros_usd >= 0),
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS context_messages_session_idx
        ON context_messages(session_id, id);
      CREATE INDEX IF NOT EXISTS context_messages_branch_idx
        ON context_messages(session_id, branch_id, id);

      CREATE TABLE IF NOT EXISTS context_checkpoints (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL UNIQUE REFERENCES context_sessions(id) ON DELETE CASCADE,
        message_id INTEGER NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS context_branches (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES context_sessions(id) ON DELETE CASCADE,
        checkpoint_id TEXT NOT NULL REFERENCES context_checkpoints(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(session_id, name)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS context_benchmark_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model TEXT NOT NULL,
        results_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
    `);
  }

  createSession(strategy: ContextStrategy): ContextSession {
    if (!(strategy in STRATEGY_TITLES)) {
      throw new TypeError("Неизвестная стратегия контекста.");
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    const facts = strategy === "facts" ? EMPTY_STICKY_FACTS : null;
    this.db.prepare(`
      INSERT INTO context_sessions (
        id, strategy, title, facts_json, active_branch_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?)
    `).run(id, strategy, STRATEGY_TITLES[strategy], facts ? JSON.stringify(facts) : null, now, now);
    return this.requireSession(id);
  }

  listSessions(): ContextSession[] {
    const rows = this.db.prepare(`
      SELECT id, strategy, title, facts_json, active_branch_id, created_at, updated_at
      FROM context_sessions
      ORDER BY updated_at DESC
    `).all() as unknown as SessionRow[];
    return rows.map(mapSession);
  }

  getSession(id: string): ContextSession | null {
    const row = this.db.prepare(`
      SELECT id, strategy, title, facts_json, active_branch_id, created_at, updated_at
      FROM context_sessions WHERE id = ?
    `).get(id) as SessionRow | undefined;
    return row ? mapSession(row) : null;
  }

  requireSession(id: string): ContextSession {
    const session = this.getSession(id);
    if (!session) throw new ContextSessionNotFoundError(id);
    return session;
  }

  private allMessages(id: string): ContextStoredMessage[] {
    const rows = this.db.prepare(`
      SELECT id, session_id, branch_id, role, content, prompt_tokens,
             completion_tokens, cost_micros_usd, created_at
      FROM context_messages WHERE session_id = ? ORDER BY id
    `).all(id) as unknown as MessageRow[];
    return rows.map(mapMessage);
  }

  getCheckpoint(id: string): ContextCheckpoint | null {
    const row = this.db.prepare(`
      SELECT id, session_id, message_id, created_at
      FROM context_checkpoints WHERE session_id = ?
    `).get(id) as CheckpointRow | undefined;
    return row ? mapCheckpoint(row) : null;
  }

  getBranches(id: string): ContextBranch[] {
    const rows = this.db.prepare(`
      SELECT id, session_id, checkpoint_id, name, created_at
      FROM context_branches WHERE session_id = ? ORDER BY name
    `).all(id) as unknown as BranchRow[];
    return rows.map(mapBranch);
  }

  getVisibleMessages(id: string): ContextStoredMessage[] {
    const session = this.requireSession(id);
    const messages = this.allMessages(id);
    if (session.strategy !== "branching") return messages;
    const checkpoint = this.getCheckpoint(id);
    if (!checkpoint) return messages.filter(({ branchId }) => branchId === null);
    if (!session.activeBranchId) return messages.filter(({ id: messageId }) => messageId <= checkpoint.messageId);
    return messages.filter(
      ({ id: messageId, branchId }) =>
        (branchId === null && messageId <= checkpoint.messageId) ||
        branchId === session.activeBranchId,
    );
  }

  getPromptMessages(id: string): ContextStoredMessage[] {
    const session = this.requireSession(id);
    const visible = this.getVisibleMessages(id);
    return session.strategy === "branching" ? visible : visible.slice(-WINDOW_MESSAGES);
  }

  getDetail(id: string): ContextSessionDetail {
    const session = this.requireSession(id);
    const messages = this.getVisibleMessages(id);
    const totals = messages.reduce(
      (sum, message) => ({
        promptTokens: sum.promptTokens + (message.promptTokens ?? 0),
        completionTokens: sum.completionTokens + (message.completionTokens ?? 0),
        costMicrosUsd: sum.costMicrosUsd + (message.costMicrosUsd ?? 0),
      }),
      { promptTokens: 0, completionTokens: 0, costMicrosUsd: 0 },
    );
    return {
      session,
      messages,
      checkpoint: this.getCheckpoint(id),
      branches: this.getBranches(id),
      retainedMessageCount: this.getPromptMessages(id).length,
      totals,
    };
  }

  saveExchange(
    sessionId: string,
    userContent: string,
    assistantContent: string,
    metrics: ContextExchangeMetrics,
    facts?: StickyFacts,
  ): void {
    const session = this.requireSession(sessionId);
    const branchId = session.strategy === "branching" ? session.activeBranchId : null;
    if (session.strategy === "branching" && this.getCheckpoint(sessionId) && !branchId) {
      throw new ContextStrategyStateError("Сначала выберите ветку диалога.");
    }
    const now = new Date().toISOString();
    const title = userContent.slice(0, 60);

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT INTO context_messages (
          session_id, branch_id, role, content, prompt_tokens,
          completion_tokens, cost_micros_usd, created_at
        ) VALUES (?, ?, 'user', ?, NULL, NULL, NULL, ?)
      `).run(sessionId, branchId, userContent, now);
      this.db.prepare(`
        INSERT INTO context_messages (
          session_id, branch_id, role, content, prompt_tokens,
          completion_tokens, cost_micros_usd, created_at
        ) VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)
      `).run(
        sessionId,
        branchId,
        assistantContent,
        metrics.providerUsage?.promptTokens ?? metrics.preflight.promptTokens,
        metrics.completionTokens,
        metrics.costMicrosUsd,
        now,
      );
      this.db.prepare(`
        UPDATE context_sessions
        SET title = CASE WHEN NOT EXISTS (
          SELECT 1 FROM context_messages WHERE session_id = ? AND id < last_insert_rowid() - 1
        ) THEN ? ELSE title END,
        facts_json = COALESCE(?, facts_json), updated_at = ?
        WHERE id = ?
      `).run(sessionId, title, facts ? JSON.stringify(facts) : null, now, sessionId);

      if (session.strategy === "sliding") {
        this.db.prepare(`
          DELETE FROM context_messages
          WHERE session_id = ? AND id NOT IN (
            SELECT id FROM context_messages
            WHERE session_id = ? ORDER BY id DESC LIMIT ?
          )
        `).run(sessionId, sessionId, WINDOW_MESSAGES);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  createCheckpoint(sessionId: string): {
    checkpoint: ContextCheckpoint;
    branches: ContextBranch[];
  } {
    const session = this.requireSession(sessionId);
    if (session.strategy !== "branching") {
      throw new ContextStrategyStateError("Checkpoint доступен только для Branching.");
    }
    if (this.getCheckpoint(sessionId)) {
      throw new ContextStrategyStateError("Checkpoint уже создан.");
    }
    const root = this.allMessages(sessionId).filter(({ branchId }) => branchId === null);
    const last = root.at(-1);
    if (!last) throw new ContextStrategyStateError("Нужен хотя бы один завершённый exchange.");

    const checkpointId = randomUUID();
    const branchA = randomUUID();
    const branchB = randomUUID();
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT INTO context_checkpoints (id, session_id, message_id, created_at)
        VALUES (?, ?, ?, ?)
      `).run(checkpointId, sessionId, last.id, now);
      const insertBranch = this.db.prepare(`
        INSERT INTO context_branches (id, session_id, checkpoint_id, name, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      insertBranch.run(branchA, sessionId, checkpointId, "Ветка A", now);
      insertBranch.run(branchB, sessionId, checkpointId, "Ветка B", now);
      this.db.prepare(`
        UPDATE context_sessions SET active_branch_id = ?, updated_at = ? WHERE id = ?
      `).run(branchA, now, sessionId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return {
      checkpoint: this.getCheckpoint(sessionId)!,
      branches: this.getBranches(sessionId),
    };
  }

  activateBranch(sessionId: string, branchId: string): ContextSessionDetail {
    const session = this.requireSession(sessionId);
    if (session.strategy !== "branching") {
      throw new ContextStrategyStateError("Ветки доступны только для Branching.");
    }
    const branch = this.getBranches(sessionId).find(({ id }) => id === branchId);
    if (!branch) throw new ContextStrategyStateError("Ветка не найдена.");
    this.db.prepare(`
      UPDATE context_sessions SET active_branch_id = ?, updated_at = ? WHERE id = ?
    `).run(branchId, new Date().toISOString(), sessionId);
    return this.getDetail(sessionId);
  }

  saveBenchmarkRun(input: ContextBenchmarkRunInput): ContextBenchmarkRun {
    const createdAt = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT INTO context_benchmark_runs (model, results_json, created_at)
      VALUES (?, ?, ?)
    `).run(input.model, JSON.stringify(input.results), createdAt);
    return {
      id: Number(result.lastInsertRowid),
      model: input.model,
      results: input.results,
      createdAt,
    };
  }

  getLatestBenchmarkRun(): ContextBenchmarkRun | null {
    const row = this.db.prepare(`
      SELECT id, model, results_json, created_at
      FROM context_benchmark_runs ORDER BY id DESC LIMIT 1
    `).get() as BenchmarkRow | undefined;
    if (!row) return null;
    return {
      id: row.id,
      model: row.model,
      results: JSON.parse(row.results_json) as ContextBenchmarkRun["results"],
      createdAt: row.created_at,
    };
  }

  close(): void {
    this.db.close();
  }
}

const globalForStore = globalThis as typeof globalThis & {
  contextStrategyStore?: SqliteContextStrategyStore;
};

export function getContextStrategyStore(): SqliteContextStrategyStore {
  globalForStore.contextStrategyStore ??= new SqliteContextStrategyStore();
  return globalForStore.contextStrategyStore;
}

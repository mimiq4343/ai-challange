import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { ensureMemorySchema } from "./memory-schema";
import { ORCHESTRATION_LIMITS, ORCHESTRATION_SERVERS, type OrchestrationServerId } from "./orchestration-config";
import type { McpServerStatus, OrchestrationCall, OrchestrationRun } from "./orchestration-types";
import { openChatDatabase, releaseChatDatabase } from "./sqlite-database";

type RunRow = {
  id: string; conversation_id: string; request: string; status: "running" | "completed" | "failed";
  error: string | null; servers_json: string | null; created_at: string; finished_at: string | null;
};
type CallRow = {
  step: number; call_id: string; server_id: OrchestrationServerId; tool: string; arguments_json: string;
  status: OrchestrationCall["status"]; started_at: string; finished_at: string | null;
};

// Запуск старше общего дедлайна агента с запасом уже не может завершиться сам.
const INTERRUPTED_AFTER_MS = ORCHESTRATION_LIMITS.timeoutMs + 60_000;

/** Журнал маршрутизации: какой сервер и инструмент вызван на каждом шаге запуска. */
export class SqliteOrchestrationStore {
  private readonly database: DatabaseSync;
  private readonly sql: Record<"insertRun" | "prune" | "servers" | "nextStep" | "insertCall" | "finishCall" | "finishRun" | "latest" | "calls", StatementSync>;
  private closed = false;

  constructor(private readonly databasePath: string) {
    this.database = openChatDatabase(databasePath);
    try {
      ensureMemorySchema(this.database);
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS orchestration_runs (
          id TEXT PRIMARY KEY,
          profile_id INTEGER NOT NULL REFERENCES memory_profiles(id) ON DELETE CASCADE,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          request TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
          error TEXT,
          servers_json TEXT,
          created_at TEXT NOT NULL,
          finished_at TEXT
        ) STRICT;
        CREATE TABLE IF NOT EXISTS orchestration_calls (
          run_id TEXT NOT NULL REFERENCES orchestration_runs(id) ON DELETE CASCADE,
          step INTEGER NOT NULL CHECK (step > 0),
          call_id TEXT NOT NULL,
          server_id TEXT NOT NULL,
          tool TEXT NOT NULL,
          arguments_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'error')),
          started_at TEXT NOT NULL,
          finished_at TEXT,
          PRIMARY KEY (run_id, step),
          UNIQUE (run_id, call_id)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS orchestration_runs_profile ON orchestration_runs(profile_id, created_at);
        CREATE INDEX IF NOT EXISTS orchestration_runs_conversation ON orchestration_runs(conversation_id);
      `);
      this.sql = {
        insertRun: this.database.prepare(`INSERT INTO orchestration_runs (id, profile_id, conversation_id, request, status, created_at)
          VALUES (?, ?, ?, ?, 'running', ?)`),
        prune: this.database.prepare(`DELETE FROM orchestration_runs WHERE profile_id = ? AND id NOT IN (
          SELECT id FROM orchestration_runs WHERE profile_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ${ORCHESTRATION_LIMITS.runRetention})`),
        servers: this.database.prepare("UPDATE orchestration_runs SET servers_json = ? WHERE id = ?"),
        nextStep: this.database.prepare("SELECT COALESCE(MAX(step), 0) + 1 AS step FROM orchestration_calls WHERE run_id = ?"),
        insertCall: this.database.prepare(`INSERT INTO orchestration_calls (run_id, step, call_id, server_id, tool, arguments_json, status, started_at)
          VALUES (?, ?, ?, ?, ?, ?, 'running', ?)`),
        finishCall: this.database.prepare("UPDATE orchestration_calls SET status = ?, finished_at = ? WHERE run_id = ? AND call_id = ? AND status = 'running'"),
        finishRun: this.database.prepare("UPDATE orchestration_runs SET status = ?, error = ?, finished_at = ? WHERE id = ? AND status = 'running'"),
        latest: this.database.prepare("SELECT * FROM orchestration_runs WHERE profile_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1"),
        calls: this.database.prepare("SELECT * FROM orchestration_calls WHERE run_id = ? ORDER BY step"),
      };
    } catch (cause) {
      releaseChatDatabase(databasePath);
      throw cause;
    }
  }

  startRun(profileId: number, conversationId: string, request: string): string {
    const runId = randomUUID();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.sql.insertRun.run(runId, profileId, conversationId, request.slice(0, ORCHESTRATION_LIMITS.requestPreviewChars), new Date().toISOString());
      this.sql.prune.run(profileId, profileId);
      this.database.exec("COMMIT");
    } catch (cause) {
      this.database.exec("ROLLBACK");
      throw cause;
    }
    return runId;
  }

  setServers(runId: string, statuses: McpServerStatus[]): void {
    this.sql.servers.run(JSON.stringify(statuses), runId);
  }

  startCall(runId: string, callId: string, serverId: string, tool: string, args: Record<string, unknown>): void {
    if (!ORCHESTRATION_SERVERS.some(({ id }) => id === serverId)) throw new Error("Вызов маршрутизирован на незарегистрированный MCP-сервер.");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const { step } = this.sql.nextStep.get(runId) as { step: number };
      this.sql.insertCall.run(runId, step, callId, serverId, tool, JSON.stringify(args), new Date().toISOString());
      this.database.exec("COMMIT");
    } catch (cause) {
      this.database.exec("ROLLBACK");
      throw cause;
    }
  }

  finishCall(runId: string, callId: string, isError: boolean): void {
    this.sql.finishCall.run(isError ? "error" : "ok", new Date().toISOString(), runId, callId);
  }

  finishRun(runId: string, outcome: { status: "completed" } | { status: "failed"; error: string }): void {
    this.sql.finishRun.run(outcome.status, outcome.status === "failed" ? outcome.error : null, new Date().toISOString(), runId);
  }

  latestRun(profileId: number, now = Date.now()): OrchestrationRun | null {
    const row = this.sql.latest.get(profileId) as RunRow | undefined;
    if (!row) return null;
    const calls = (this.sql.calls.all(row.id) as CallRow[]).map((call): OrchestrationCall => ({
      step: call.step, callId: call.call_id, serverId: call.server_id, tool: call.tool,
      arguments: JSON.parse(call.arguments_json) as Record<string, unknown>,
      status: call.status, startedAt: call.started_at, finishedAt: call.finished_at,
    }));
    const stale = row.status === "running" && now - Date.parse(row.created_at) > INTERRUPTED_AFTER_MS;
    return {
      runId: row.id, conversationId: row.conversation_id, request: row.request,
      status: stale ? "interrupted" : row.status, error: row.error,
      servers: row.servers_json ? JSON.parse(row.servers_json) as McpServerStatus[] : null,
      calls, createdAt: row.created_at, finishedAt: row.finished_at,
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    releaseChatDatabase(this.databasePath);
  }
}

const globalForOrchestrationStore = globalThis as typeof globalThis & { orchestrationStore?: SqliteOrchestrationStore };

export function getOrchestrationStore(): SqliteOrchestrationStore {
  globalForOrchestrationStore.orchestrationStore ??= new SqliteOrchestrationStore(join(process.cwd(), "data", "chat.sqlite"));
  return globalForOrchestrationStore.orchestrationStore;
}

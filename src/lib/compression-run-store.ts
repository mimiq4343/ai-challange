import "server-only";

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { parseBlindJudgeResult } from "./blind-judge";
import type {
  BenchmarkCallMetrics,
  CompressionRun,
  CompressionRunInput,
} from "./compression-types";

type CompressionRunRow = {
  id: number;
  model: string;
  summary: string;
  full_answer: string;
  compressed_answer: string;
  label_a: CompressionRun["labelA"];
  judge_json: string;
  summary_prompt_tokens: number;
  summary_completion_tokens: number;
  summary_cost_micros_usd: number;
  full_prompt_tokens: number;
  full_completion_tokens: number;
  full_cost_micros_usd: number;
  compressed_prompt_tokens: number;
  compressed_completion_tokens: number;
  compressed_cost_micros_usd: number;
  judge_prompt_tokens: number;
  judge_completion_tokens: number;
  judge_cost_micros_usd: number;
  gross_saved_tokens: number;
  summary_overhead_tokens: number;
  net_saved_tokens: number;
  created_at: string;
};

function callMetrics(
  promptTokens: number,
  completionTokens: number,
  costMicrosUsd: number,
): BenchmarkCallMetrics {
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    costMicrosUsd,
  };
}

function mapRun(row: CompressionRunRow): CompressionRun {
  return {
    id: row.id,
    model: row.model,
    summary: row.summary,
    fullAnswer: row.full_answer,
    compressedAnswer: row.compressed_answer,
    labelA: row.label_a,
    judge: parseBlindJudgeResult(row.judge_json),
    calls: {
      summary: callMetrics(
        row.summary_prompt_tokens,
        row.summary_completion_tokens,
        row.summary_cost_micros_usd,
      ),
      full: callMetrics(
        row.full_prompt_tokens,
        row.full_completion_tokens,
        row.full_cost_micros_usd,
      ),
      compressed: callMetrics(
        row.compressed_prompt_tokens,
        row.compressed_completion_tokens,
        row.compressed_cost_micros_usd,
      ),
      judge: callMetrics(
        row.judge_prompt_tokens,
        row.judge_completion_tokens,
        row.judge_cost_micros_usd,
      ),
    },
    grossSavedTokens: row.gross_saved_tokens,
    summaryOverheadTokens: row.summary_overhead_tokens,
    netSavedTokens: row.net_saved_tokens,
    createdAt: row.created_at,
  };
}

export class SqliteCompressionRunStore {
  private readonly database: DatabaseSync;
  private readonly insertStatement: StatementSync;
  private readonly latestStatement: StatementSync;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath, { timeout: 5_000 });
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS compression_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model TEXT NOT NULL,
        summary TEXT NOT NULL CHECK (length(summary) > 0),
        full_answer TEXT NOT NULL CHECK (length(full_answer) > 0),
        compressed_answer TEXT NOT NULL CHECK (length(compressed_answer) > 0),
        label_a TEXT NOT NULL CHECK (label_a IN ('full', 'compressed')),
        judge_json TEXT NOT NULL CHECK (json_valid(judge_json)),
        summary_prompt_tokens INTEGER NOT NULL CHECK (summary_prompt_tokens >= 0),
        summary_completion_tokens INTEGER NOT NULL CHECK (summary_completion_tokens >= 0),
        summary_cost_micros_usd INTEGER NOT NULL CHECK (summary_cost_micros_usd >= 0),
        full_prompt_tokens INTEGER NOT NULL CHECK (full_prompt_tokens >= 0),
        full_completion_tokens INTEGER NOT NULL CHECK (full_completion_tokens >= 0),
        full_cost_micros_usd INTEGER NOT NULL CHECK (full_cost_micros_usd >= 0),
        compressed_prompt_tokens INTEGER NOT NULL CHECK (compressed_prompt_tokens >= 0),
        compressed_completion_tokens INTEGER NOT NULL CHECK (compressed_completion_tokens >= 0),
        compressed_cost_micros_usd INTEGER NOT NULL CHECK (compressed_cost_micros_usd >= 0),
        judge_prompt_tokens INTEGER NOT NULL CHECK (judge_prompt_tokens >= 0),
        judge_completion_tokens INTEGER NOT NULL CHECK (judge_completion_tokens >= 0),
        judge_cost_micros_usd INTEGER NOT NULL CHECK (judge_cost_micros_usd >= 0),
        gross_saved_tokens INTEGER NOT NULL,
        summary_overhead_tokens INTEGER NOT NULL CHECK (summary_overhead_tokens >= 0),
        net_saved_tokens INTEGER NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
    `);
    this.insertStatement = this.database.prepare(`
      INSERT INTO compression_runs (
        model, summary, full_answer, compressed_answer, label_a, judge_json,
        summary_prompt_tokens, summary_completion_tokens, summary_cost_micros_usd,
        full_prompt_tokens, full_completion_tokens, full_cost_micros_usd,
        compressed_prompt_tokens, compressed_completion_tokens,
        compressed_cost_micros_usd, judge_prompt_tokens,
        judge_completion_tokens, judge_cost_micros_usd, gross_saved_tokens,
        summary_overhead_tokens, net_saved_tokens, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.latestStatement = this.database.prepare(`
      SELECT * FROM compression_runs ORDER BY id DESC LIMIT 1
    `);
  }

  saveRun(input: CompressionRunInput): CompressionRun {
    const createdAt = new Date().toISOString();
    const result = this.insertStatement.run(
      input.model,
      input.summary,
      input.fullAnswer,
      input.compressedAnswer,
      input.labelA,
      JSON.stringify(input.judge),
      input.calls.summary.promptTokens,
      input.calls.summary.completionTokens,
      input.calls.summary.costMicrosUsd,
      input.calls.full.promptTokens,
      input.calls.full.completionTokens,
      input.calls.full.costMicrosUsd,
      input.calls.compressed.promptTokens,
      input.calls.compressed.completionTokens,
      input.calls.compressed.costMicrosUsd,
      input.calls.judge.promptTokens,
      input.calls.judge.completionTokens,
      input.calls.judge.costMicrosUsd,
      input.grossSavedTokens,
      input.summaryOverheadTokens,
      input.netSavedTokens,
      createdAt,
    );
    return { ...input, id: Number(result.lastInsertRowid), createdAt };
  }

  getLatestRun(): CompressionRun | null {
    const row = this.latestStatement.get() as CompressionRunRow | undefined;
    return row ? mapRun(row) : null;
  }

  close(): void {
    this.database.close();
  }
}

const globalForStore = globalThis as typeof globalThis & {
  compressionRunStore?: SqliteCompressionRunStore;
};

export function getCompressionRunStore(): SqliteCompressionRunStore {
  globalForStore.compressionRunStore ??= new SqliteCompressionRunStore(
    join(process.cwd(), "data", "chat.sqlite"),
  );
  return globalForStore.compressionRunStore;
}

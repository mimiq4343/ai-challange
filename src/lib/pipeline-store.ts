import { randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import * as z from "zod/v4";
import type { GitHubRepositoryInfo } from "./github-repository-tool";
import { ensureMemorySchema } from "./memory-schema";
import { PIPELINE_LIMITS } from "./pipeline-config";
import { pipelineRepositoriesSchema, pipelineToolResult, pipelineToolSchemas } from "./pipeline-tool-schemas";
import type { PipelineReport, PipelineSearchResult, PipelineSummary } from "./pipeline-types";
import { openChatDatabase, releaseChatDatabase } from "./sqlite-database";

type SearchRow = { id: string; query: string; repositories_json: string; created_at: string };
type SummaryRow = { id: string; search_result_id: string; markdown: string; created_at: string };
type ReportRow = { id: string; summary_id: string; search_result_id: string; query: string; created_at: string };

export class PipelineNotFoundError extends Error {
  constructor() {
    super("Результат pipeline не найден в текущем профиле.");
    this.name = "PipelineNotFoundError";
  }
}

function toReport(row: ReportRow): PipelineReport {
  return {
    reportId: row.id, summaryId: row.summary_id, searchResultId: row.search_result_id,
    query: row.query, fileName: `${row.id}.md`, downloadUrl: `/api/pipeline/reports/${row.id}`, createdAt: row.created_at,
  };
}

export class SqlitePipelineStore {
  private readonly database: DatabaseSync;
  private readonly sql: Record<"profile" | "search" | "summary" | "report" | "reportBySummary" | "list" | "insertSearch" | "insertSummary" | "insertReport", StatementSync>;
  private closed = false;

  constructor(private readonly databasePath: string, private readonly reportsDirectory = join(dirname(databasePath), "reports")) {
    this.database = openChatDatabase(databasePath);
    try {
      ensureMemorySchema(this.database);
      // Владение наследуется от неизменяемого поиска; сводка и файл не могут сменить профиль или источник.
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS pipeline_search_results (
          id TEXT PRIMARY KEY,
          profile_id INTEGER NOT NULL REFERENCES memory_profiles(id) ON DELETE CASCADE,
          query TEXT NOT NULL,
          repositories_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS pipeline_summaries (
          id TEXT PRIMARY KEY,
          search_result_id TEXT NOT NULL REFERENCES pipeline_search_results(id) ON DELETE CASCADE,
          markdown TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS pipeline_reports (
          id TEXT PRIMARY KEY,
          summary_id TEXT NOT NULL UNIQUE REFERENCES pipeline_summaries(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS pipeline_search_profile ON pipeline_search_results(profile_id);
        CREATE INDEX IF NOT EXISTS pipeline_summary_source ON pipeline_summaries(search_result_id);
      `);
      const reportQuery = `SELECT r.id, r.summary_id, s.search_result_id, q.query, r.created_at
        FROM pipeline_reports r JOIN pipeline_summaries s ON s.id = r.summary_id
        JOIN pipeline_search_results q ON q.id = s.search_result_id WHERE q.profile_id = ?`;
      this.sql = {
        profile: this.database.prepare("SELECT id FROM memory_profiles WHERE id = ?"),
        search: this.database.prepare("SELECT * FROM pipeline_search_results WHERE profile_id = ? AND id = ?"),
        summary: this.database.prepare(`SELECT s.* FROM pipeline_summaries s
          JOIN pipeline_search_results q ON q.id = s.search_result_id WHERE q.profile_id = ? AND s.id = ?`),
        report: this.database.prepare(`${reportQuery} AND r.id = ?`),
        reportBySummary: this.database.prepare(`${reportQuery} AND r.summary_id = ?`),
        list: this.database.prepare(`${reportQuery} ORDER BY r.created_at DESC, r.rowid DESC LIMIT ${PIPELINE_LIMITS.reportLimit}`),
        insertSearch: this.database.prepare("INSERT INTO pipeline_search_results (id, profile_id, query, repositories_json, created_at) VALUES (?, ?, ?, ?, ?)"),
        insertSummary: this.database.prepare("INSERT INTO pipeline_summaries (id, search_result_id, markdown, created_at) VALUES (?, ?, ?, ?)"),
        insertReport: this.database.prepare("INSERT INTO pipeline_reports (id, summary_id, created_at) VALUES (?, ?, ?)"),
      };
    } catch (cause) {
      releaseChatDatabase(databasePath);
      throw cause;
    }
  }

  saveSearch(profileId: number, query: string, repositories: GitHubRepositoryInfo[]): PipelineSearchResult {
    if (!this.sql.profile.get(profileId)) throw new PipelineNotFoundError();
    const parsed = pipelineToolSchemas.search_repositories.parse({ query });
    const result: PipelineSearchResult = {
      searchResultId: randomUUID(), query: parsed.query,
      repositories: pipelineRepositoriesSchema.parse(repositories), createdAt: new Date().toISOString(),
    };
    pipelineToolResult(result);
    this.sql.insertSearch.run(result.searchResultId, profileId, result.query, JSON.stringify(result.repositories), result.createdAt);
    return result;
  }

  getSearch(profileId: number, searchResultId: string): PipelineSearchResult | null {
    if (!z.uuid().safeParse(searchResultId).success) return null;
    const row = this.sql.search.get(profileId, searchResultId) as SearchRow | undefined;
    return row ? {
      searchResultId: row.id, query: row.query,
      repositories: pipelineRepositoriesSchema.parse(JSON.parse(row.repositories_json)), createdAt: row.created_at,
    } : null;
  }

  saveSummary(profileId: number, searchResultId: string, markdown: string): PipelineSummary {
    if (!this.getSearch(profileId, searchResultId)) throw new PipelineNotFoundError();
    if (!markdown.trim() || Buffer.byteLength(markdown, "utf8") > PIPELINE_LIMITS.summaryMaxBytes) {
      throw new Error("Сводка пуста или превышает допустимый размер.");
    }
    const summary: PipelineSummary = { summaryId: randomUUID(), searchResultId, markdown, createdAt: new Date().toISOString() };
    pipelineToolResult(summary);
    this.sql.insertSummary.run(summary.summaryId, searchResultId, markdown, summary.createdAt);
    return summary;
  }

  getSummary(profileId: number, summaryId: string): PipelineSummary | null {
    if (!z.uuid().safeParse(summaryId).success) return null;
    const row = this.sql.summary.get(profileId, summaryId) as SummaryRow | undefined;
    return row ? { summaryId: row.id, searchResultId: row.search_result_id, markdown: row.markdown, createdAt: row.created_at } : null;
  }

  saveReport(profileId: number, summaryId: string): PipelineReport {
    // Короткая синхронная транзакция сериализует повторный save даже между процессами.
    this.database.exec("BEGIN IMMEDIATE");
    let createdFile: string | undefined;
    try {
      const summary = this.getSummary(profileId, summaryId);
      if (!summary) throw new PipelineNotFoundError();
      const existing = this.sql.reportBySummary.get(profileId, summaryId) as ReportRow | undefined;
      if (existing) {
        const download = this.getReportDownload(profileId, existing.id);
        if (!download) throw new PipelineNotFoundError();
        this.database.exec("COMMIT");
        return download.report;
      }
      const search = this.getSearch(profileId, summary.searchResultId);
      if (!search) throw new PipelineNotFoundError();
      const reportId = randomUUID();
      const report: PipelineReport = {
        reportId, summaryId, searchResultId: search.searchResultId, query: search.query,
        fileName: `${reportId}.md`, downloadUrl: `/api/pipeline/reports/${reportId}`, createdAt: new Date().toISOString(),
      };
      pipelineToolResult(report);
      mkdirSync(this.reportsDirectory, { recursive: true, mode: 0o700 });
      const path = join(this.reportsDirectory, report.fileName);
      // wx никогда не перезаписывает существующий файл или символическую ссылку.
      const fd = openSync(path, "wx", 0o600);
      createdFile = path;
      try {
        writeFileSync(fd, summary.markdown, "utf8");
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      const directoryFd = openSync(this.reportsDirectory, constants.O_RDONLY | constants.O_DIRECTORY);
      try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
      this.sql.insertReport.run(reportId, summaryId, report.createdAt);
      this.database.exec("COMMIT");
      return report;
    } catch (cause) {
      this.database.exec("ROLLBACK");
      if (createdFile) {
        try { unlinkSync(createdFile); } catch (cleanupError) {
          throw new AggregateError([cause, cleanupError], "Не удалось сохранить отчёт и удалить незавершённый файл.");
        }
      }
      throw cause;
    }
  }

  listReports(profileId: number): PipelineReport[] {
    return (this.sql.list.all(profileId) as ReportRow[]).map(toReport);
  }

  getReportDownload(profileId: number, reportId: string): { report: PipelineReport; bytes: Buffer } | null {
    if (!z.uuid().safeParse(reportId).success) return null;
    const row = this.sql.report.get(profileId, reportId) as ReportRow | undefined;
    if (!row) return null;
    const report = toReport(row);
    const summary = this.getSummary(profileId, report.summaryId);
    if (!summary) throw new Error("Источник сохранённого отчёта отсутствует.");
    let fd: number | undefined;
    try {
      fd = openSync(join(this.reportsDirectory, report.fileName), constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = fstatSync(fd);
      if (!info.isFile() || info.size > PIPELINE_LIMITS.summaryMaxBytes) throw new Error("Некорректный файл отчёта.");
      const bytes = readFileSync(fd);
      if (!bytes.equals(Buffer.from(summary.markdown, "utf8"))) throw new Error("Файл отчёта не совпадает с сохранённой сводкой.");
      return { report, bytes };
    } catch (cause) {
      throw new Error("Сохранённый файл отчёта недоступен или повреждён.", { cause });
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    releaseChatDatabase(this.databasePath);
  }
}

const globalForPipelineStore = globalThis as typeof globalThis & { pipelineStore?: SqlitePipelineStore };

export function getPipelineStore(): SqlitePipelineStore {
  globalForPipelineStore.pipelineStore ??= new SqlitePipelineStore(join(process.cwd(), "data", "chat.sqlite"));
  return globalForPipelineStore.pipelineStore;
}

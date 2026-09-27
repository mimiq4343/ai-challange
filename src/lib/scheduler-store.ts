import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import * as z from "zod/v4";

import { githubRepositoryInputSchema, githubRepositoryOutputSchema, type GitHubRepositoryInfo } from "./github-repository-tool";
import { SCHEDULER_LIMITS } from "./scheduler-config";
import { ensureSchedulerSchema } from "./scheduler-schema";
import type { ScheduleAggregate, ScheduleClaim, ScheduleInput, ScheduleJob, ScheduleRun, ScheduleSample } from "./scheduler-types";
import { openChatDatabase, releaseChatDatabase } from "./sqlite-database";

const scheduleInput = z.strictObject({
  ...githubRepositoryInputSchema,
  intervalMinutes: z.number().int().min(SCHEDULER_LIMITS.minIntervalMinutes).max(SCHEDULER_LIMITS.maxIntervalMinutes),
});
const repositoryInput = z.strictObject(githubRepositoryOutputSchema);
const storedSample = z.object({ collectedAt: z.iso.datetime(), repository: repositoryInput });
const storedAggregate = z.object({
  job: z.object({
    ...scheduleInput.shape, id: z.uuid(), profileId: z.number().int(),
    status: z.enum(["active", "stopped"]), createdAt: z.iso.datetime(),
    nextRunAt: z.iso.datetime().nullable(), lastRunAt: z.iso.datetime().nullable(),
  }),
  from: z.iso.datetime(), to: z.iso.datetime(), sampleCount: z.number().int().nonnegative(),
  failedRuns: z.number().int().nonnegative(), first: storedSample.nullable(), latest: storedSample.nullable(),
  starsChange: z.number().int().nullable(), forksChange: z.number().int().nullable(),
});

type CountRow = { total: number };
type SchedulerStatements = Record<
  "profile" | "job" | "list" | "duplicate" | "count" | "create" | "stop" | "cancel"
  | "runs" | "jobRuns" | "due" | "running" | "insertRun" | "recover" | "claimJob"
  | "claimRun" | "save" | "release" | "finish" | "advance" | "sampleCount" | "first"
  | "latest" | "failures", StatementSync
>;

type JobRow = {
  id: string; profile_id: number; owner: string; repo: string; interval_minutes: number;
  status: ScheduleJob["status"]; created_at: string; next_run_at: string | null; last_run_at: string | null;
};
type RunRow = {
  id: string; job_id: string; scheduled_for: string; started_at: string; finished_at: string | null;
  status: ScheduleRun["status"]; collected_at: string | null; repository_json: string | null;
  aggregate_json: string | null; summary: string | null; error: string | null;
};

export class SchedulerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchedulerValidationError";
  }
}

function toJob(row: JobRow): ScheduleJob {
  return {
    id: row.id, profileId: row.profile_id, owner: row.owner, repo: row.repo,
    intervalMinutes: row.interval_minutes, status: row.status, createdAt: row.created_at,
    nextRunAt: row.next_run_at, lastRunAt: row.last_run_at,
  };
}

function toSample(row: Pick<RunRow, "collected_at" | "repository_json">): ScheduleSample | null {
  return row.collected_at && row.repository_json
    ? { collectedAt: row.collected_at, repository: repositoryInput.parse(JSON.parse(row.repository_json)) }
    : null;
}

function toRun(row: RunRow): ScheduleRun {
  return {
    id: row.id, jobId: row.job_id, scheduledFor: row.scheduled_for, startedAt: row.started_at,
    finishedAt: row.finished_at, status: row.status, sample: toSample(row),
    aggregate: row.aggregate_json ? storedAggregate.parse(JSON.parse(row.aggregate_json)) : null,
    summary: row.summary, error: row.error,
  };
}

function prepareStatements(database: DatabaseSync): SchedulerStatements {
  // Все операции с lease сверяют не только токен, но и профиль, срок и состояние задания.
  const claimWhere = `id = ? AND job_id = ? AND lease_token = ? AND status = 'running'
    AND lease_expires_at > ? AND EXISTS (
      SELECT 1 FROM scheduler_jobs j WHERE j.id = scheduler_runs.job_id AND j.profile_id = ? AND j.status = 'active'
    )`;
  return {
    profile: database.prepare("SELECT id FROM memory_profiles WHERE id = ?"),
    job: database.prepare("SELECT * FROM scheduler_jobs WHERE profile_id = ? AND id = ?"),
    list: database.prepare("SELECT * FROM scheduler_jobs WHERE profile_id = ? ORDER BY created_at DESC, id DESC"),
    duplicate: database.prepare("SELECT * FROM scheduler_jobs WHERE profile_id = ? AND owner = ? AND repo = ? AND status = 'active'"),
    count: database.prepare("SELECT count(*) AS total FROM scheduler_jobs WHERE status = 'active'"),
    create: database.prepare(`INSERT INTO scheduler_jobs
      (id, profile_id, owner, repo, interval_minutes, status, created_at, next_run_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?) RETURNING *`),
    stop: database.prepare("UPDATE scheduler_jobs SET status = 'stopped', next_run_at = NULL WHERE profile_id = ? AND id = ? RETURNING *"),
    cancel: database.prepare(`UPDATE scheduler_runs SET status = 'cancelled', finished_at = ?,
      lease_token = NULL, lease_expires_at = NULL, error = 'Мониторинг остановлен.' WHERE job_id = ? AND status = 'running'`),
    runs: database.prepare(`SELECT r.* FROM scheduler_runs r JOIN scheduler_jobs j ON j.id = r.job_id
      WHERE j.profile_id = ? ORDER BY r.started_at DESC, r.id DESC LIMIT ?`),
    jobRuns: database.prepare(`SELECT r.* FROM scheduler_runs r JOIN scheduler_jobs j ON j.id = r.job_id
      WHERE j.profile_id = ? AND j.id = ? ORDER BY r.started_at DESC, r.id DESC LIMIT ?`),
    due: database.prepare(`SELECT j.* FROM scheduler_jobs j
      LEFT JOIN scheduler_runs r ON r.job_id = j.id AND r.status = 'running'
      WHERE j.status = 'active' AND j.next_run_at <= ? AND (r.id IS NULL OR r.lease_expires_at <= ?)
      ORDER BY j.next_run_at ASC, j.created_at ASC, j.id ASC LIMIT 1`),
    running: database.prepare("SELECT * FROM scheduler_runs WHERE job_id = ? AND status = 'running'"),
    insertRun: database.prepare(`INSERT INTO scheduler_runs
      (id, job_id, scheduled_for, started_at, status, lease_token, lease_expires_at)
      VALUES (?, ?, ?, ?, 'running', ?, ?)`),
    recover: database.prepare("UPDATE scheduler_runs SET lease_token = ?, lease_expires_at = ? WHERE id = ?"),
    claimJob: database.prepare("UPDATE scheduler_jobs SET next_run_at = ?, last_run_at = ? WHERE id = ? RETURNING *"),
    claimRun: database.prepare(`SELECT * FROM scheduler_runs WHERE ${claimWhere}`),
    save: database.prepare(`UPDATE scheduler_runs SET collected_at = ?, repository_json = ?
      WHERE ${claimWhere} AND repository_json IS NULL`),
    release: database.prepare(`UPDATE scheduler_runs SET lease_expires_at = ? WHERE ${claimWhere}`),
    finish: database.prepare(`UPDATE scheduler_runs SET status = ?, finished_at = ?, summary = ?, aggregate_json = ?, error = ?,
      lease_token = NULL, lease_expires_at = NULL WHERE ${claimWhere}`),
    advance: database.prepare("UPDATE scheduler_jobs SET next_run_at = ? WHERE id = ? AND profile_id = ? AND status = 'active'"),
    sampleCount: database.prepare(`SELECT count(*) AS total FROM scheduler_runs
      WHERE job_id = ? AND collected_at BETWEEN ? AND ?`),
    first: database.prepare(`SELECT collected_at, repository_json FROM scheduler_runs
      WHERE job_id = ? AND collected_at BETWEEN ? AND ? ORDER BY collected_at ASC, scheduled_for ASC LIMIT 1`),
    latest: database.prepare(`SELECT collected_at, repository_json FROM scheduler_runs
      WHERE job_id = ? AND collected_at BETWEEN ? AND ? ORDER BY collected_at DESC, scheduled_for DESC LIMIT 1`),
    failures: database.prepare(`SELECT count(*) AS total FROM scheduler_runs
      WHERE job_id = ? AND status = 'failed' AND finished_at BETWEEN ? AND ?`),
  };
}

export class SqliteSchedulerStore {
  private readonly database: DatabaseSync;
  private readonly sql: SchedulerStatements;
  private closed = false;

  constructor(private readonly databasePath: string) {
    this.database = openChatDatabase(databasePath);
    try {
      ensureSchedulerSchema(this.database);
      this.sql = prepareStatements(this.database);
    } catch (error) {
      releaseChatDatabase(databasePath);
      throw error;
    }
  }

  private transaction<T>(operation: () => T, readOnly = false): T {
    this.database.exec(readOnly ? "BEGIN" : "BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  create(profileId: number, input: ScheduleInput, now = Date.now()): ScheduleJob {
    const parsed = scheduleInput.safeParse(input);
    if (!parsed.success) {
      throw new SchedulerValidationError(`Укажите owner/repo GitHub и целый интервал от ${SCHEDULER_LIMITS.minIntervalMinutes} до ${SCHEDULER_LIMITS.maxIntervalMinutes} минут.`);
    }
    return this.transaction(() => {
      if (!Number.isSafeInteger(profileId) || !this.sql.profile.get(profileId)) {
        throw new SchedulerValidationError("Профиль не найден.");
      }
      const { owner, repo, intervalMinutes } = parsed.data;
      const duplicate = this.sql.duplicate.get(profileId, owner, repo) as JobRow | undefined;
      if (duplicate) {
        if (duplicate.interval_minutes !== intervalMinutes) {
          throw new SchedulerValidationError("Этот репозиторий уже отслеживается с другим интервалом. Сначала остановите прежнее задание.");
        }
        return toJob(duplicate);
      }
      const count = this.sql.count.get() as CountRow;
      if (count.total >= SCHEDULER_LIMITS.maxActiveJobs) {
        throw new SchedulerValidationError(`Достигнут общий лимит: ${SCHEDULER_LIMITS.maxActiveJobs} активных заданий. Сначала остановите одно из них.`);
      }
      const timestamp = new Date(now).toISOString();
      return toJob(this.sql.create.get(randomUUID(), profileId, owner, repo, intervalMinutes, timestamp, timestamp) as JobRow);
    });
  }

  list(profileId: number): ScheduleJob[] {
    return (this.sql.list.all(profileId) as JobRow[]).map(toJob);
  }

  stop(profileId: number, jobId: string, now = Date.now()): ScheduleJob | null {
    return this.transaction(() => {
      const job = this.sql.stop.get(profileId, jobId) as JobRow | undefined;
      if (!job) return null;
      this.sql.cancel.run(new Date(now).toISOString(), jobId);
      return toJob(job);
    });
  }

  listRuns(profileId: number, jobId?: string, limit: number = SCHEDULER_LIMITS.feedLimit): ScheduleRun[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new SchedulerValidationError("Число запусков должно быть целым от 1 до 100.");
    }
    const rows = (jobId === undefined ? this.sql.runs.all(profileId, limit)
      : this.sql.jobRuns.all(profileId, jobId, limit)) as RunRow[];
    return rows.map(toRun);
  }

  getSummary(profileId: number, jobId: string, periodHours: number = SCHEDULER_LIMITS.defaultPeriodHours, now = Date.now()): ScheduleAggregate | null {
    if (!Number.isSafeInteger(periodHours) || periodHours < 1 || periodHours > SCHEDULER_LIMITS.maxPeriodHours) {
      throw new SchedulerValidationError(`Период должен быть целым от 1 до ${SCHEDULER_LIMITS.maxPeriodHours} часов.`);
    }
    return this.transaction(() => {
      const row = this.sql.job.get(profileId, jobId) as JobRow | undefined;
      if (!row) return null;
      const from = new Date(now - periodHours * 3_600_000).toISOString();
      const to = new Date(now).toISOString();
      const count = this.sql.sampleCount.get(jobId, from, to) as CountRow;
      const failures = this.sql.failures.get(jobId, from, to) as CountRow;
      const sampleCount = count.total;
      const firstRow = this.sql.first.get(jobId, from, to) as RunRow | undefined;
      const latestRow = this.sql.latest.get(jobId, from, to) as RunRow | undefined;
      const first = firstRow ? toSample(firstRow) : null;
      const latest = latestRow ? toSample(latestRow) : null;
      return {
        job: toJob(row), from, to, sampleCount,
        failedRuns: failures.total,
        first, latest,
        starsChange: sampleCount >= 2 && first && latest ? latest.repository.stars - first.repository.stars : null,
        forksChange: sampleCount >= 2 && first && latest ? latest.repository.forks - first.repository.forks : null,
      };
    }, true);
  }

  claimDue(now = Date.now()): ScheduleClaim | null {
    return this.transaction(() => {
      const timestamp = new Date(now).toISOString();
      const row = this.sql.due.get(timestamp, now) as JobRow | undefined;
      if (!row) return null;
      const running = this.sql.running.get(row.id) as RunRow | undefined;
      const leaseToken = randomUUID();
      const expiresAt = now + SCHEDULER_LIMITS.leaseMs;
      let runId: string;
      let scheduledFor: string;
      if (running) {
        // Перезапуск продолжает тот же запуск и его замер, а не создаёт дубль сводки.
        runId = running.id;
        scheduledFor = running.scheduled_for;
        this.sql.recover.run(leaseToken, expiresAt, runId);
      } else {
        runId = randomUUID();
        const due = Date.parse(row.next_run_at!);
        const interval = row.interval_minutes * 60_000;
        // После простоя собираем только актуальный замер, без очереди пропущенных слотов.
        scheduledFor = new Date(due + Math.floor((now - due) / interval) * interval).toISOString();
        this.sql.insertRun.run(runId, row.id, scheduledFor, timestamp, leaseToken, expiresAt);
      }
      const job = toJob(this.sql.claimJob.get(scheduledFor, timestamp, row.id) as JobRow);
      return { job, runId, leaseToken };
    });
  }

  getClaimRun(claim: ScheduleClaim, now = Date.now()): ScheduleRun | null {
    const row = this.sql.claimRun.get(claim.runId, claim.job.id, claim.leaseToken, now, claim.job.profileId) as RunRow | undefined;
    return row ? toRun(row) : null;
  }

  saveSample(claim: ScheduleClaim, repository: GitHubRepositoryInfo, now = Date.now()): boolean {
    const parsed = repositoryInput.safeParse(repository);
    if (!parsed.success) throw new SchedulerValidationError("Некорректные данные замера GitHub.");
    return this.sql.save.run(new Date(now).toISOString(), JSON.stringify(parsed.data),
      claim.runId, claim.job.id, claim.leaseToken, now, claim.job.profileId).changes > 0;
  }

  releaseClaim(claim: ScheduleClaim, now = Date.now()): boolean {
    // При SIGTERM оставляем данные и логический запуск для немедленного восстановления.
    return this.sql.release.run(now, claim.runId, claim.job.id, claim.leaseToken, now, claim.job.profileId).changes > 0;
  }

  complete(claim: ScheduleClaim, result: { summary: string | null; aggregate: ScheduleAggregate | null; error: string | null }, now = Date.now()): boolean {
    return this.transaction(() => {
      const row = this.sql.claimRun.get(claim.runId, claim.job.id, claim.leaseToken, now, claim.job.profileId) as RunRow | undefined;
      if (!row) return false;
      if ((result.summary === null) === (result.error === null)) {
        throw new SchedulerValidationError("Запуск должен содержать либо сводку, либо ошибку.");
      }
      const job = this.sql.job.get(claim.job.profileId, claim.job.id) as JobRow;
      this.sql.finish.run(result.error === null ? "completed" : "failed", new Date(now).toISOString(),
        result.summary, result.aggregate === null ? null : JSON.stringify(result.aggregate), result.error,
        claim.runId, job.id, claim.leaseToken, now, job.profile_id);
      const scheduled = Date.parse(row.scheduled_for);
      const interval = job.interval_minutes * 60_000;
      const next = scheduled + Math.max(1, Math.floor((now - scheduled) / interval) + 1) * interval;
      this.sql.advance.run(new Date(next).toISOString(), job.id, job.profile_id);
      return true;
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    releaseChatDatabase(this.databasePath);
  }
}

const globalForSchedulerStore = globalThis as typeof globalThis & { schedulerStore?: SqliteSchedulerStore };

export function getSchedulerStore(): SqliteSchedulerStore {
  globalForSchedulerStore.schedulerStore ??= new SqliteSchedulerStore(join(process.cwd(), "data", "chat.sqlite"));
  return globalForSchedulerStore.schedulerStore;
}

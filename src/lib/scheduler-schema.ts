import type { DatabaseSync } from "node:sqlite";

import { ensureMemorySchema } from "./memory-schema";
import { SCHEDULER_LIMITS } from "./scheduler-config";

export function ensureSchedulerSchema(database: DatabaseSync): void {
  ensureMemorySchema(database);
  database.exec(`
    CREATE TABLE IF NOT EXISTS scheduler_jobs (
      id TEXT PRIMARY KEY,
      profile_id INTEGER NOT NULL REFERENCES memory_profiles(id) ON DELETE CASCADE,
      owner TEXT NOT NULL COLLATE NOCASE,
      repo TEXT NOT NULL COLLATE NOCASE,
      interval_minutes INTEGER NOT NULL CHECK (
        interval_minutes BETWEEN ${SCHEDULER_LIMITS.minIntervalMinutes} AND ${SCHEDULER_LIMITS.maxIntervalMinutes}
      ),
      status TEXT NOT NULL CHECK (status IN ('active', 'stopped')),
      created_at TEXT NOT NULL,
      next_run_at TEXT,
      last_run_at TEXT,
      CHECK ((status = 'active' AND next_run_at IS NOT NULL) OR (status = 'stopped' AND next_run_at IS NULL))
    ) STRICT;

    CREATE UNIQUE INDEX IF NOT EXISTS scheduler_active_repository
      ON scheduler_jobs(profile_id, owner, repo) WHERE status = 'active';
    CREATE INDEX IF NOT EXISTS scheduler_due ON scheduler_jobs(next_run_at) WHERE status = 'active';

    CREATE TABLE IF NOT EXISTS scheduler_runs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES scheduler_jobs(id) ON DELETE CASCADE,
      scheduled_for TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
      lease_token TEXT,
      lease_expires_at INTEGER,
      collected_at TEXT,
      repository_json TEXT,
      aggregate_json TEXT,
      summary TEXT,
      error TEXT,
      UNIQUE (job_id, scheduled_for),
      CHECK ((collected_at IS NULL) = (repository_json IS NULL)),
      CHECK ((status = 'running' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR (status != 'running' AND lease_token IS NULL AND lease_expires_at IS NULL))
    ) STRICT;

    CREATE UNIQUE INDEX IF NOT EXISTS scheduler_running_job
      ON scheduler_runs(job_id) WHERE status = 'running';
    CREATE INDEX IF NOT EXISTS scheduler_samples ON scheduler_runs(job_id, collected_at);
    CREATE INDEX IF NOT EXISTS scheduler_feed ON scheduler_runs(started_at DESC);
  `);
}

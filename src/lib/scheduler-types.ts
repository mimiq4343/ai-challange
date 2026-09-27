import type { GitHubRepositoryInfo } from "./github-repository-tool";

export type ScheduleInput = { owner: string; repo: string; intervalMinutes: number };

export type ScheduleJob = ScheduleInput & {
  id: string;
  profileId: number;
  status: "active" | "stopped";
  createdAt: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
};

export type ScheduleSample = {
  collectedAt: string;
  repository: GitHubRepositoryInfo;
};

export type ScheduleAggregate = {
  job: ScheduleJob;
  from: string;
  to: string;
  sampleCount: number;
  failedRuns: number;
  first: ScheduleSample | null;
  latest: ScheduleSample | null;
  starsChange: number | null;
  forksChange: number | null;
};

export type ScheduleRun = {
  id: string;
  jobId: string;
  scheduledFor: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "completed" | "failed" | "cancelled";
  sample: ScheduleSample | null;
  aggregate: ScheduleAggregate | null;
  summary: string | null;
  error: string | null;
};

export type ScheduleClaim = {
  job: ScheduleJob;
  runId: string;
  leaseToken: string;
};

export type SchedulerSnapshot = {
  jobs: ScheduleJob[];
  runs: ScheduleRun[];
};

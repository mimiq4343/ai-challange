import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import { ChatAgentError } from "../src/lib/chat-agent";
import type { ChatAgentResponse } from "../src/lib/conversation-types";
import { GitHubRepositoryError, type GitHubRepositoryInfo } from "../src/lib/github-repository-tool";
import { SqliteProfileStore } from "../src/lib/profile-store";
import { SqliteSchedulerStore } from "../src/lib/scheduler-store";
import { readSchedulerSummary, SchedulerSummaryError } from "../src/lib/scheduler-summary";
import { runSchedulerOnce } from "../src/lib/scheduler-worker";

const start = Date.parse("2026-09-27T12:00:00.000Z");
const repository: GitHubRepositoryInfo = {
  fullName: "octocat/Hello-World", description: "Пример", language: "TypeScript",
  stars: 100, forks: 20, url: "https://github.com/octocat/Hello-World",
};

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "flash-scheduler-worker-"));
  const path = join(directory, "chat.sqlite");
  const store = new SqliteSchedulerStore(path);
  const profiles = new SqliteProfileStore(path);
  t.after(async () => { profiles.close(); store.close(); await rm(directory, { recursive: true, force: true }); });
  const profileId = profiles.getActiveProfile().id;
  const job = store.create(profileId, { owner: "octocat", repo: "Hello-World", intervalMinutes: 15 }, start);
  return { store, profiles, profileId, job };
}

test("LLM failure retains the collected sample and an explicit safe failure", async (t) => {
  const { store, profileId, job } = await fixture(t);
  await runSchedulerOnce(store, {
    now: () => start + 1,
    fetchRepository: async () => repository,
    summarize: async () => { throw new ChatAgentError("secret upstream body", "upstream"); },
  });
  const run = store.listRuns(profileId)[0];
  assert.equal(run.status, "failed");
  assert.equal(run.sample?.repository.stars, 100);
  assert.equal(run.aggregate?.sampleCount, 1);
  assert.equal(run.summary, null);
  assert.ok(run.error);
  assert.equal(run.error.includes("secret upstream body"), false);
  assert.equal(store.getSummary(profileId, job.id, 24, start + 2)?.failedRuns, 1);
  assert.equal(store.list(profileId)[0].nextRunAt, "2026-09-27T12:15:00.000Z");
});

test("an expected GitHub error does not prevent the next due job completing", async (t) => {
  const { store, profileId, job } = await fixture(t);
  const next = store.create(profileId, { owner: "octocat", repo: "second", intervalMinutes: 15 }, start + 1);
  const dependencies = {
    now: () => start + 2,
    fetchRepository: async ({ repo }: { owner: string; repo: string }) => {
      if (repo === "Hello-World") throw new GitHubRepositoryError("RATE_LIMIT", "Лимит GitHub");
      return { ...repository, fullName: "octocat/second", url: "https://github.com/octocat/second" };
    },
    summarize: async () => "Первый замер: 100 звёзд, 20 форков; динамики пока нет.",
  };
  assert.equal(await runSchedulerOnce(store, dependencies), true);
  assert.equal(await runSchedulerOnce(store, dependencies), true);
  assert.equal(await runSchedulerOnce(store, dependencies), false);
  assert.equal(store.listRuns(profileId, job.id)[0].status, "failed");
  const completed = store.listRuns(profileId, next.id)[0];
  assert.equal(completed.status, "completed");
  assert.equal(completed.aggregate?.starsChange, null);
  assert.equal(completed.sample?.repository.fullName, "octocat/second");
});

test("a stopped job never starts summarizing a late collection or publishes a late summary", async (t) => {
  const { store, profileId, job } = await fixture(t);
  let summaries = 0;
  await runSchedulerOnce(store, {
    now: () => start + 1,
    fetchRepository: async () => { store.stop(profileId, job.id, start + 1); return repository; },
    summarize: async () => { summaries += 1; return "Недопустимо"; },
  });
  assert.equal(summaries, 0);
  assert.equal(store.listRuns(profileId)[0].status, "cancelled");
  assert.equal(store.listRuns(profileId)[0].sample, null);
  const next = store.create(profileId, { owner: "octocat", repo: "second", intervalMinutes: 15 }, start + 2);
  await runSchedulerOnce(store, {
    now: () => start + 3,
    fetchRepository: async () => repository,
    summarize: async () => { store.stop(profileId, next.id, start + 3); return "Поздняя сводка"; },
  });
  assert.equal(store.listRuns(profileId, next.id)[0].summary, null);
  assert.equal(store.listRuns(profileId, next.id)[0].status, "cancelled");
  assert.equal(store.list(profileId).find((value) => value.id === next.id)?.nextRunAt, null);
});

test("recovery summarizes a persisted sample rather than collecting twice", async (t) => {
  const { store, profileId } = await fixture(t);
  const stale = store.claimDue(start)!;
  store.saveSample(stale, repository, start + 1);
  await runSchedulerOnce(store, {
    now: () => start + 120_001,
    fetchRepository: async () => { throw new Error("Повторный запрос потерял исходный замер"); },
    summarize: async (aggregate) => `Звёзд: ${aggregate.latest?.repository.stars}; замеров: ${aggregate.sampleCount}`,
  });
  const runs = store.listRuns(profileId);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].id, stale.runId);
  assert.equal(runs[0].status, "completed");
  assert.equal(runs[0].summary, "Звёзд: 100; замеров: 1");
});

test("shutdown during summarization preserves the sample and releases the run for recovery", async (t) => {
  const { store, profileId } = await fixture(t);
  const controller = new AbortController();
  await runSchedulerOnce(store, {
    now: () => start + 1,
    fetchRepository: async () => repository,
    summarize: async () => { controller.abort(); return "Нельзя опубликовать"; },
  }, controller.signal);
  const run = store.listRuns(profileId)[0];
  assert.equal(run.status, "running");
  assert.equal(run.summary, null);
  assert.equal(run.sample?.repository.stars, 100);
  assert.equal(store.claimDue(start + 2)?.runId, run.id);
});

function response(text: string, finishReason: string | null): ChatAgentResponse {
  return {
    stream: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); } }),
    usage: Promise.resolve(null), finishReason: Promise.resolve(finishReason),
  };
}

test("only nonempty bounded text with an explicit stop finish reason is a valid summary", async () => {
  const signal = new AbortController().signal;
  assert.equal(await readSchedulerSummary(response(" Готовая сводка ", "stop"), signal), "Готовая сводка");
  for (const reason of [null, "length", "content_filter", "tool_calls"]) {
    await assert.rejects(readSchedulerSummary(response("Частичный ответ", reason), signal), SchedulerSummaryError);
  }
  await assert.rejects(readSchedulerSummary(response("  ", "stop"), signal), SchedulerSummaryError);
  await assert.rejects(readSchedulerSummary(response("я".repeat(10_000), "stop"), signal), SchedulerSummaryError);
  const noReason = response("Без подтверждения", "stop");
  delete noReason.finishReason;
  await assert.rejects(readSchedulerSummary(noReason, signal), SchedulerSummaryError);
});

test("interrupted streams cannot publish their already received prefix", async () => {
  let reads = 0;
  const broken: ChatAgentResponse = {
    stream: new ReadableStream({ pull(controller) {
      if (reads++ === 0) controller.enqueue(new TextEncoder().encode("Незавершённая сводка"));
      else controller.error(new Error("stream disconnected"));
    } }), usage: Promise.resolve(null), finishReason: Promise.resolve("stop"),
  };
  await assert.rejects(readSchedulerSummary(broken, new AbortController().signal), SchedulerSummaryError);
});

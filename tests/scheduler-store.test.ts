import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, type TestContext } from "node:test";

import type { GitHubRepositoryInfo } from "../src/lib/github-repository-tool";
import { SqliteProfileStore } from "../src/lib/profile-store";
import { SchedulerValidationError, SqliteSchedulerStore } from "../src/lib/scheduler-store";

const start = Date.parse("2026-09-27T12:00:00.000Z");
const repository: GitHubRepositoryInfo = {
  fullName: "octocat/Hello-World", description: "Пример", language: "TypeScript",
  stars: 100, forks: 20, url: "https://github.com/octocat/Hello-World",
};
const input = { owner: "octocat", repo: "Hello-World", intervalMinutes: 15 };

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "flash-scheduler-"));
  const path = join(directory, "chat.sqlite");
  const stores: Array<{ close(): void }> = [];
  const track = <T extends { close(): void }>(store: T): T => {
    stores.push(store);
    return store;
  };
  const closeAll = () => { for (const store of stores.splice(0).reverse()) store.close(); };
  t.after(async () => { closeAll(); await rm(directory, { recursive: true, force: true }); });
  const store = track(new SqliteSchedulerStore(path));
  const profiles = track(new SqliteProfileStore(path));
  return { store, profiles, profileId: profiles.getActiveProfile().id, path, track, closeAll };
}

test("jobs, runs and samples survive closing all database connections", async (t) => {
  const f = await fixture(t);
  const job = f.store.create(f.profileId, input, start);
  const claim = f.store.claimDue(start)!;
  f.store.saveSample(claim, repository, start + 1);
  f.store.complete(claim, { summary: "Первый замер", aggregate: null, error: null }, start + 2);
  const runs = f.store.listRuns(f.profileId);
  f.closeAll();
  const reopened = f.track(new SqliteSchedulerStore(f.path));
  assert.equal(reopened.list(f.profileId)[0].id, job.id);
  assert.equal(reopened.list(f.profileId)[0].nextRunAt, "2026-09-27T12:15:00.000Z");
  assert.deepEqual(reopened.listRuns(f.profileId), runs);
  assert.equal(reopened.getSummary(f.profileId, job.id, 24, start + 3)?.latest?.repository.stars, 100);
});

test("every profile-facing operation and profile deletion isolate schedules", async (t) => {
  const { store, profiles, profileId } = await fixture(t);
  const second = profiles.createProfile({ name: "Другой" });
  const one = store.create(profileId, input, start);
  const two = store.create(second.id, input, start + 1);
  const claim = store.claimDue(start)!;
  store.saveSample(claim, repository, start + 2);
  assert.deepEqual(store.list(second.id), [two]);
  assert.equal(store.stop(second.id, one.id, start + 3), null);
  assert.equal(store.getSummary(second.id, one.id, 24, start + 3), null);
  assert.deepEqual(store.listRuns(second.id, one.id), []);
  assert.equal(store.saveSample({ ...claim, job: { ...claim.job, profileId: second.id } }, repository, start + 3), false);
  profiles.deleteProfile(second.id);
  assert.deepEqual(store.list(second.id), []);
  assert.equal(store.list(profileId)[0].id, one.id);
});

test("active duplicates ignore GitHub case but cannot silently change the interval", async (t) => {
  const { store, profileId } = await fixture(t);
  const job = store.create(profileId, input, start);
  assert.equal(store.create(profileId, { ...input, owner: "OctoCat", repo: "hello-world" }, start + 1).id, job.id);
  assert.throws(() => store.create(profileId, { ...input, intervalMinutes: 30 }, start), SchedulerValidationError);
  store.stop(profileId, job.id, start + 2);
  assert.notEqual(store.create(profileId, { ...input, intervalMinutes: 30 }, start + 3).id, job.id);
});

test("active quota is global across profiles and released only by stopping", async (t) => {
  const { store, profiles, profileId } = await fixture(t);
  const second = profiles.createProfile({ name: "Другой" });
  const jobs = Array.from({ length: 5 }, (_, index) => store.create(
    index % 2 ? second.id : profileId, { ...input, repo: `repo-${index}` }, start,
  ));
  assert.throws(() => store.create(second.id, { ...input, repo: "sixth" }, start), SchedulerValidationError);
  assert.equal(store.create(profileId, { ...input, repo: "REPO-0" }, start).id, jobs[0].id);
  store.stop(profileId, jobs[0].id, start);
  assert.equal(store.create(second.id, { ...input, repo: "sixth" }, start).status, "active");
});

test("invalid intervals, repository paths and missing profiles cannot create jobs", async (t) => {
  const { store, profileId } = await fixture(t);
  for (const intervalMinutes of [0, 14, 15.5, 10081, NaN]) {
    assert.throws(() => store.create(profileId, { ...input, intervalMinutes }, start), SchedulerValidationError);
  }
  for (const repo of ["", "../private", "..", "repo?token=secret"]) {
    assert.throws(() => store.create(profileId, { ...input, repo }, start), SchedulerValidationError);
  }
  assert.throws(() => store.create(999999, input, start), SchedulerValidationError);
  assert.deepEqual(store.list(profileId), []);
});

test("independent processes atomically claim one occurrence on two connections", async (t) => {
  const { store, profileId, path } = await fixture(t);
  store.create(profileId, input, start);
  const source = `const { SqliteSchedulerStore } = require(${JSON.stringify(resolve("src/lib/scheduler-store.ts"))});
    const store = new SqliteSchedulerStore(${JSON.stringify(path)});
    process.stdout.write("ready\\n");
    process.stdin.once("data", () => {
      console.log(JSON.stringify(store.claimDue(${start})));
      store.close(); process.stdin.destroy();
    });`;
  function contender() {
    const child = spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", "-e", source], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    t.after(() => { child.kill(); });
    let output = "";
    let errors = "";
    let ready!: () => void;
    const started = new Promise<void>((resolve) => { ready = resolve; });
    child.stdout.on("data", (chunk) => { output += String(chunk); if (output.includes("ready\n")) ready(); });
    child.stderr.on("data", (chunk) => { errors += String(chunk); });
    const result = new Promise<unknown>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code) => {
        ready();
        if (code !== 0) reject(new Error(errors));
        else resolve(JSON.parse(output.split("\n")[1]));
      });
    });
    return { child, started, result };
  }
  const first = contender();
  const second = contender();
  await Promise.all([first.started, second.started]);
  first.child.stdin.end("claim");
  second.child.stdin.end("claim");
  const claims = await Promise.all([first.result, second.result]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(store.listRuns(profileId).length, 1);
  assert.equal(store.listRuns(profileId)[0].status, "running");
});

test("stopping fences late samples and success without rescheduling", async (t) => {
  const { store, profileId } = await fixture(t);
  const job = store.create(profileId, input, start);
  const claim = store.claimDue(start)!;
  store.saveSample(claim, repository, start + 1);
  assert.equal(store.stop(profileId, job.id, start + 2)?.nextRunAt, null);
  assert.equal(store.saveSample(claim, { ...repository, stars: 999 }, start + 3), false);
  assert.equal(store.complete(claim, { summary: "Поздний ответ", aggregate: null, error: null }, start + 3), false);
  assert.equal(store.claimDue(start + 900_000), null);
  const run = store.listRuns(profileId)[0];
  assert.equal(run.status, "cancelled");
  assert.equal(run.summary, null);
  assert.equal(run.sample?.repository.stars, 100);
});

test("expired leases reuse the logical run and saved sample while fencing the old worker", async (t) => {
  const f = await fixture(t);
  f.store.create(f.profileId, input, start);
  const stale = f.store.claimDue(start)!;
  f.store.saveSample(stale, repository, start + 1);
  assert.equal(f.store.claimDue(start + 119_999), null);
  assert.equal(f.store.complete(stale, { summary: "Просрочено", aggregate: null, error: null }, start + 120_000), false);
  f.closeAll();
  const store = f.track(new SqliteSchedulerStore(f.path));
  const fresh = store.claimDue(start + 120_000)!;
  assert.equal(fresh.runId, stale.runId);
  assert.notEqual(fresh.leaseToken, stale.leaseToken);
  assert.equal(store.getClaimRun(fresh, start + 120_001)?.sample?.repository.stars, 100);
  assert.equal(store.saveSample(stale, { ...repository, stars: 1 }, start + 120_001), false);
  assert.equal(store.complete(stale, { summary: "Старый", aggregate: null, error: null }, start + 120_001), false);
  assert.equal(store.complete(fresh, { summary: "Восстановлено", aggregate: null, error: null }, start + 120_002), true);
  assert.equal(store.listRuns(f.profileId).length, 1);
  assert.equal(store.listRuns(f.profileId)[0].summary, "Восстановлено");
});

test("downtime coalesces missed slots and completion advances to a future schedule boundary", async (t) => {
  const { store, profileId } = await fixture(t);
  store.create(profileId, input, start);
  const claim = store.claimDue(start + 65 * 60_000)!;
  assert.equal(store.listRuns(profileId)[0].scheduledFor, "2026-09-27T13:00:00.000Z");
  store.complete(claim, { summary: null, aggregate: null, error: "GitHub недоступен" }, start + 65 * 60_000 + 1);
  assert.equal(store.list(profileId)[0].nextRunAt, "2026-09-27T13:15:00.000Z");
  assert.equal(store.claimDue(start + 65 * 60_000 + 2), null);
  assert.equal(store.listRuns(profileId).length, 1);
});

test("aggregates count real samples, preserve signed deltas and exclude running from failures", async (t) => {
  const { store, profileId } = await fixture(t);
  const job = store.create(profileId, input, start);
  const first = store.claimDue(start)!;
  assert.equal(store.getSummary(profileId, job.id, 24, start)?.sampleCount, 0);
  store.saveSample(first, repository, start + 1);
  const baseline = store.getSummary(profileId, job.id, 24, start + 2)!;
  assert.equal(baseline.sampleCount, 1);
  assert.equal(baseline.starsChange, null);
  assert.equal(baseline.forksChange, null);
  assert.equal(baseline.failedRuns, 0);
  store.complete(first, { summary: null, aggregate: baseline, error: "LLM недоступна" }, start + 3);
  const second = store.claimDue(start + 900_000)!;
  store.saveSample(second, { ...repository, stars: 107, forks: 17 }, start + 900_001);
  const aggregate = store.getSummary(profileId, job.id, 24, start + 900_002)!;
  assert.equal(aggregate.sampleCount, 2);
  assert.equal(aggregate.failedRuns, 1);
  assert.equal(aggregate.starsChange, 7);
  assert.equal(aggregate.forksChange, -3);
  assert.equal(aggregate.first?.repository.stars, 100);
  assert.equal(aggregate.latest?.repository.stars, 107);
  const narrowed = store.getSummary(profileId, job.id, 1, start + 3_700_000)!;
  assert.equal(narrowed.sampleCount, 1);
  assert.equal(narrowed.failedRuns, 0);
  assert.equal(narrowed.starsChange, null);
});

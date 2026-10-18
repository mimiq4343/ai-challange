import assert from "node:assert/strict";
import { test } from "node:test";
import { readReleaseCi } from "../src/lib/release-ci";

const head = "a".repeat(40);
const run = (id: number, workflow: number, status: string, conclusion: string | null, sha = head) => ({
  id, workflow_id: workflow, name: `Checks ${workflow}`, head_sha: sha, status, conclusion,
  event: "push", html_url: `https://github.com/owner/repo/actions/runs/${id}`,
});
const read = (fetcher: typeof fetch) => readReleaseCi("owner/repo", head, AbortSignal.timeout(5_000), undefined, fetcher);

test("CI selects latest run per workflow and event for the exact release commit", async () => {
  const ci = await read(async () => Response.json({ total_count: 4, workflow_runs: [
    run(12, 1, "completed", "success"), run(11, 2, "completed", "failure"), run(10, 1, "completed", "failure"),
    run(13, 3, "completed", "success", "b".repeat(40)),
  ] }));
  assert.equal(ci.state, "failed"); assert.deepEqual(ci.runs.map(item => item.id), [12, 11]);
});

test("CI never treats no runs, an in-progress run or a skipped run as success", async () => {
  assert.equal((await read(async () => Response.json({ total_count: 0, workflow_runs: [] }))).state, "missing");
  for (const [status, conclusion] of [["in_progress", null], ["completed", "skipped"], ["completed", "neutral"]]) {
    assert.notEqual((await read(async () => Response.json({ total_count: 1, workflow_runs: [run(1, 1, status!, conclusion)] }))).state, "success");
  }
});

test("CI reports HTTP errors and timeouts explicitly without leaking upstream responses", async () => {
  const forbidden = await read(async () => new Response("private upstream detail", { status: 403 }));
  assert.equal(forbidden.state, "unavailable"); assert.match(forbidden.message, /403/);
  assert.equal(JSON.stringify(forbidden).includes("private upstream detail"), false);
  assert.equal((await read(async () => { throw new DOMException("timed out", "TimeoutError"); })).state, "unavailable");
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readReleaseCi("owner/repo", head, controller.signal, undefined, async () => { throw new Error(); }));
});

test("CI paginates and cannot declare success from an incomplete set of runs", async () => {
  let page = 0;
  const ci = await read(async () => Response.json({ total_count: 101, workflow_runs: ++page === 1
    ? Array.from({ length: 100 }, (_, index) => run(200 - index, 1, "completed", "success"))
    : [run(99, 2, "completed", "failure")] }));
  assert.equal(ci.state, "failed"); assert.equal(ci.runs.length, 2);
});

test("CI confirms successful completed runs but reports pagination limits as partial", async () => {
  assert.equal((await read(async () => Response.json({ total_count: 1, workflow_runs: [run(1, 1, "completed", "success")] }))).state, "success");
  const ci = await read(async () => Response.json({ total_count: 501, workflow_runs:
    Array.from({ length: 100 }, (_, index) => run(200 - index, 1, "completed", "success")),
  }));
  assert.equal(ci.state, "partial");
});

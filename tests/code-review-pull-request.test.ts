import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchReviewPullRequest, readReviewPullRequest } from "../src/lib/code-review-pull-request";

const payload = { number: 42, base: { sha: "a".repeat(40), repo: { full_name: "owner/repo" } }, head: { sha: "b".repeat(40) } };

test("PR metadata is bound to the current repository and exact base/head SHAs", async () => {
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(String(url), "https://api.github.com/repos/owner/repo/pulls/42");
    assert.equal(new Headers(init?.headers).get("X-GitHub-Api-Version"), "2026-03-10");
    assert.equal(new Headers(init?.headers).get("Authorization"), null);
    return Response.json(payload);
  };
  assert.deepEqual(await readReviewPullRequest("owner/repo", 42, AbortSignal.timeout(1000), undefined, fetcher), { repository: "owner/repo", number: 42, baseSha: "a".repeat(40), headSha: "b".repeat(40) });
  for (const changed of [{ ...payload, number: 7 }, { ...payload, base: { ...payload.base, repo: { full_name: "other/repo" } } }, { ...payload, head: { sha: "main" } }]) {
    await assert.rejects(readReviewPullRequest("owner/repo", 42, AbortSignal.timeout(1000), undefined, async () => Response.json(changed)));
  }
});

test("PR errors, transport failure and cancellation never expose credentials or response bodies", async () => {
  await assert.rejects(readReviewPullRequest("owner/repo", 42, AbortSignal.timeout(1000), "secret-key", async () => new Response("private response", { status: 404 })), (error: Error) => {
    assert.match(error.message, /404/); assert.doesNotMatch(error.message, /secret-key|private response/); return true;
  });
  await assert.rejects(readReviewPullRequest("owner/repo", 42, AbortSignal.timeout(1000), undefined, async () => { throw new TypeError("network failure"); }), /GitHub/);
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  await assert.rejects(readReviewPullRequest("owner/repo", 42, controller.signal), /cancelled/);
});

test("PR fetch reads immutable objects without changing branches, working files or FETCH_HEAD", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "flash-pr-fetch-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, "app"); const remote = join(directory, "remote");
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
  execFileSync("git", ["init", "-qb", "main", root]);
  git(root, "config", "user.name", "Test"); git(root, "config", "user.email", "test@example.com");
  await writeFile(join(root, "README.md"), "base\n"); git(root, "add", "."); git(root, "commit", "-qm", "base");
  const baseSha = git(root, "rev-parse", "HEAD");
  execFileSync("git", ["clone", "-q", root, remote]);
  git(remote, "config", "user.name", "Test"); git(remote, "config", "user.email", "test@example.com");
  await writeFile(join(remote, "README.md"), "PR change\n"); git(remote, "add", "."); git(remote, "commit", "-qm", "head");
  const headSha = git(remote, "rev-parse", "HEAD");
  git(root, "config", `url.file://${remote}.insteadOf`, "https://github.com/owner/repo.git");
  await writeFile(join(root, ".git/FETCH_HEAD"), "preserved\n");
  await writeFile(join(root, "README.md"), "dirty\n");
  const refs = git(root, "show-ref");
  await fetchReviewPullRequest(root, { repository: "owner/repo", number: 42, baseSha, headSha }, AbortSignal.timeout(5000), "fixture-token");
  assert.equal(git(root, "cat-file", "-t", headSha), "commit");
  assert.equal(git(root, "rev-parse", "HEAD"), baseSha);
  assert.equal(git(root, "show-ref"), refs);
  assert.equal(await readFile(join(root, "README.md"), "utf8"), "dirty\n");
  assert.equal(await readFile(join(root, ".git/FETCH_HEAD"), "utf8"), "preserved\n");
  assert.doesNotMatch(await readFile(join(root, ".git/config"), "utf8"), /fixture-token|AUTHORIZATION/);
});

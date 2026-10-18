import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readReviewWorkspace } from "../src/lib/code-review-git";
import { handleCodeReview } from "../src/lib/code-review-http";
import { consumeCodeReviewStream } from "../src/lib/code-review-web-stream";
import type { CodeReviewEvent } from "../src/lib/code-review-types";

async function repository(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "flash-review-web-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  git("init", "-qb", "main"); git("config", "user.email", "test@example.com"); git("config", "user.name", "Test");
  git("remote", "add", "origin", "git@github.com:owner/repo.git");
  await mkdir(join(root, "src"));
  await writeFile(join(root, "README.md"), "# Project\n");
  await writeFile(join(root, "src/store.ts"), "export const value = 1;\n");
  git("add", "."); git("commit", "-qm", "base"); git("branch", "day-32");
  return { root, git };
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/code-review", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost", ...headers }, body: JSON.stringify(body) });
}

test("web branch choices expose committed SHAs and repository, without checking out branches", async (t) => {
  const { root, git } = await repository(t);
  const workspace = await readReviewWorkspace(root);
  assert.equal(workspace.repository, "owner/repo");
  assert.equal(workspace.baseRef, "refs/heads/main");
  assert.equal(workspace.headRef, "HEAD");
  assert.ok(workspace.branches.some((branch) => branch.ref === "refs/heads/day-32" && branch.sha === git("rev-parse", "day-32")));
  assert.equal(git("branch", "--show-current"), "main");
});

test("web review streams an unchanged committed snapshot and a complete report without model calls", async (t) => {
  const { root, git } = await repository(t);
  await writeFile(join(root, "src/store.ts"), "uncommitted change\n");
  const response = await handleCodeReview(request({ baseRef: "refs/heads/main", headRef: "refs/heads/day-32" }), root);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type")!, /application\/x-ndjson/);
  const events: CodeReviewEvent[] = [];
  await consumeCodeReviewStream(response.body!, (event) => events.push(event));
  const snapshot = events.find((event) => event.type === "snapshot");
  assert.equal(snapshot?.type === "snapshot" && snapshot.snapshot.totalFiles, 0);
  const result = events.find((event) => event.type === "result");
  assert.equal(result?.type === "result" && result.report.snapshot.headSha, git("rev-parse", "HEAD"));
  assert.equal(result?.type === "result" && result.report.indexId, null);
  assert.equal(git("status", "--porcelain"), "M src/store.ts");
});

test("web review rejects foreign origins, unknown refs and oversized or malformed bodies", async (t) => {
  const { root } = await repository(t);
  const valid = { baseRef: "refs/heads/main", headRef: "HEAD" };
  assert.equal((await handleCodeReview(request(valid, { Origin: "https://evil.example" }), root)).status, 403);
  for (const payload of [{ ...valid, headRef: "--output=/tmp/evil" }, { ...valid, root: "/etc" }, { ...valid, baseRef: "missing" }, {}]) {
    assert.equal((await handleCodeReview(request(payload), root)).status, 400);
  }
  assert.equal((await handleCodeReview(request({ ...valid, headRef: "x".repeat(5_000) }), root)).status, 413);
  const malformed = new Request("http://localhost/api/code-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
  assert.equal((await handleCodeReview(malformed, root)).status, 400);
});

test("web review returns an explicit failure when credentials are missing, never an empty success", async (t) => {
  const { root, git } = await repository(t);
  git("switch", "-q", "day-32");
  await writeFile(join(root, "src/store.ts"), "export const value = 2;\n"); git("add", "."); git("commit", "-qm", "change");
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const response = await handleCodeReview(request({ baseRef: "refs/heads/main", headRef: "HEAD" }), root);
    const events: CodeReviewEvent[] = [];
    await assert.rejects(() => consumeCodeReviewStream(response.body!, (event) => events.push(event)), /OPENAI_API_KEY/);
    assert.ok(events.some((event) => event.type === "snapshot"));
    assert.equal(events.some((event) => event.type === "result"), false);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous;
  }
});

test("web stream refuses truncated, malformed and failed responses", async () => {
  for (const [body, message] of [
    ['{"type":"progress","message":"RAG"}\n', /оборвал/],
    ['{"type":"error","message":"Модель недоступна"}\n', /Модель недоступна/],
    ['{"type":"progress","message":42}\n', /событи/],
    ['{"type":"result","report":{}}\n', /событи/],
  ] as const) {
    await assert.rejects(() => consumeCodeReviewStream(new Response(body).body!, () => {}), message);
  }
});

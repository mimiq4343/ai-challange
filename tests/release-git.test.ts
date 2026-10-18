import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { collectReleaseSnapshot, readReleaseWorkspace } from "../src/lib/release-git";

test("release binds branch and annotated tag choices to immutable commits without reading working changes or secrets", async t => {
  const root = await mkdtemp(join(tmpdir(), "flash-release-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  git("init", "-qb", "main"); git("config", "user.email", "test@example.com"); git("config", "user.name", "Test");
  git("remote", "add", "origin", "git@github.com:owner/repo.git");
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src/chat.ts"), "export const answer = 1;\n");
  git("add", "."); git("commit", "-qm", "base"); git("tag", "-a", "v1", "-m", "first");
  const base = git("rev-parse", "HEAD");
  git("switch", "-qc", "feature");
  await writeFile(join(root, "src/chat.ts"), "export const answer = 2;\n");
  await writeFile(join(root, ".env.local"), "PRIVATE_FIXTURE=must-not-leak\n");
  git("add", "."); git("commit", "-qm", "feat: answer two");
  const head = git("rev-parse", "HEAD");
  await writeFile(join(root, "src/chat.ts"), "local edit\n");
  const workspace = await readReleaseWorkspace(root);
  assert.equal(workspace.branches.find(ref => ref.ref === "refs/tags/v1")?.sha, base);
  const snapshot = await collectReleaseSnapshot(root, workspace, "refs/tags/v1", "refs/heads/feature", AbortSignal.timeout(10_000));
  assert.equal(snapshot.baseSha, base); assert.equal(snapshot.headSha, head);
  assert.equal(snapshot.commits.length, 1); assert.equal(snapshot.commits[0].subject, "feat: answer two");
  assert.match(snapshot.files[0].patch, /\+export const answer = 2/);
  assert.equal(snapshot.skipped.length, 1);
  assert.equal(JSON.stringify(snapshot).includes("must-not-leak"), false);
  assert.equal(git("rev-parse", "HEAD"), head);
  assert.equal(await readFile(join(root, "src/chat.ts"), "utf8"), "local edit\n");
  await assert.rejects(collectReleaseSnapshot(root, workspace, "main", "--output=/tmp/evil", AbortSignal.timeout(10_000)), /Ветка|ref/);
  await assert.rejects(collectReleaseSnapshot(root, workspace, "HEAD", "HEAD", AbortSignal.timeout(10_000)), /совпадают|изменений/);
});

test("release rejects divergent branches rather than silently replacing the selected base with their merge base", async t => {
  const root = await mkdtemp(join(tmpdir(), "flash-release-diverged-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  git("init", "-qb", "main"); git("config", "user.email", "test@example.com"); git("config", "user.name", "Test");
  git("remote", "add", "origin", "https://github.com/owner/repo.git");
  await writeFile(join(root, "README.md"), "base\n"); git("add", "."); git("commit", "-qm", "base"); git("branch", "feature");
  await writeFile(join(root, "README.md"), "main\n"); git("add", "."); git("commit", "-qm", "main");
  git("switch", "-q", "feature"); await writeFile(join(root, "README.md"), "feature\n"); git("add", "."); git("commit", "-qm", "feature");
  await assert.rejects(collectReleaseSnapshot(root, await readReleaseWorkspace(root), "refs/heads/main", "HEAD", AbortSignal.timeout(10_000)), /предком/);
});

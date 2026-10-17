import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, renameSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { PROJECT_MCP_LIMITS } from "../src/lib/dev-assistant-config";
import { listTrackedEntries, parsePorcelainStatus, ProjectGitError, readGitBranch, readGitDiff, readGitStatus } from "../src/lib/project-git";
import { projectToolSchemas } from "../src/lib/project-tool-schemas";

let root: string;
const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });

before(() => {
  root = mkdtempSync(join(tmpdir(), "project-git-"));
  git("init", "-q", "-b", "day-31");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  mkdirSync(join(root, "docs/nested"), { recursive: true });
  writeFileSync(join(root, "README.md"), "# Проект\n");
  writeFileSync(join(root, "docs/api.md"), "# API\n");
  writeFileSync(join(root, "docs/nested/old name.md"), "# Старое имя\n");
  writeFileSync(join(root, "big.txt"), "a\n");
  git("add", ".");
  git("commit", "-q", "-m", "feat: первый коммит");
});
after(() => rmSync(root, { recursive: true, force: true }));

test("reads the current branch, HEAD and last commit", async () => {
  const branch = await readGitBranch(root);
  assert.equal(branch.branch, "day-31");
  assert.equal(branch.detached, false);
  assert.match(branch.head ?? "", /^[0-9a-f]{12}$/);
  assert.equal(branch.upstream, null);
  assert.equal(branch.lastCommit?.subject, "feat: первый коммит");
});

test("reports detached HEAD without a branch name", async () => {
  git("checkout", "-q", "--detach");
  try {
    const branch = await readGitBranch(root);
    assert.equal(branch.branch, null);
    assert.equal(branch.detached, true);
  } finally {
    git("checkout", "-q", "day-31");
  }
});

test("parses modified, renamed with spaces and untracked files", async () => {
  writeFileSync(join(root, "README.md"), "# Проект\n\nИзменение\n");
  renameSync(join(root, "docs/nested/old name.md"), join(root, "docs/nested/new name.md"));
  git("add", "-A", "docs");
  writeFileSync(join(root, "notes.txt"), "черновик\n");
  try {
    const status = await readGitStatus(root);
    assert.equal(status.clean, false);
    assert.deepEqual(status.files.find((file) => file.path === "README.md"), { path: "README.md", kind: "changed", index: ".", worktree: "M" });
    assert.deepEqual(status.files.find((file) => file.kind === "renamed"), {
      path: "docs/nested/new name.md", kind: "renamed", index: "R", worktree: ".", from: "docs/nested/old name.md",
    });
    assert.ok(status.files.some((file) => file.path === "notes.txt" && file.kind === "untracked"));
  } finally {
    git("reset", "-q", "--hard");
    rmSync(join(root, "notes.txt"));
  }
});

test("rejects porcelain records of an unknown format", () => {
  assert.throws(() => parsePorcelainStatus("# branch.head main\0x something\0"), ProjectGitError);
  assert.deepEqual(parsePorcelainStatus("# branch.oid (initial)\0# branch.head main\0# branch.ab +2 -1\0"), {
    branch: "main", head: null, upstream: null, ahead: 2, behind: 1, files: [],
  });
});

test("lists immediate children of a tracked directory", async () => {
  assert.deepEqual((await listTrackedEntries(root, "")).entries, [
    { name: "docs", type: "directory", files: 2 },
    { name: "big.txt", type: "file", files: 1 },
    { name: "README.md", type: "file", files: 1 },
  ]);
  assert.deepEqual((await listTrackedEntries(root, "docs")).entries, [
    { name: "nested", type: "directory", files: 1 },
    { name: "api.md", type: "file", files: 1 },
  ]);
  assert.deepEqual((await listTrackedEntries(root, "docs/api.md")).entries, [{ name: "api.md", type: "file", files: 1 }]);
  await assert.rejects(listTrackedEntries(root, "missing"), /не существует в рабочей копии/);
  assert.equal((await listTrackedEntries(root, "docs")).status, "tracked");
});

test("reports ignored and untracked directories without listing their contents", async () => {
  writeFileSync(join(root, ".git/info/exclude"), "data/\n");
  mkdirSync(join(root, "data"));
  mkdirSync(join(root, "drafts"));
  writeFileSync(join(root, "data/chat.sqlite"), "secret rows");
  writeFileSync(join(root, "drafts/plan.md"), "черновик");
  try {
    assert.deepEqual(await listTrackedEntries(root, "data"), { path: "data", status: "ignored", totalFiles: 0, truncated: false, entries: [] });
    assert.deepEqual(await listTrackedEntries(root, "drafts"), { path: "drafts", status: "untracked", totalFiles: 0, truncated: false, entries: [] });
  } finally {
    rmSync(join(root, "data"), { recursive: true });
    rmSync(join(root, "drafts"), { recursive: true });
    writeFileSync(join(root, ".git/info/exclude"), "");
  }
});

test("hides untracked and ignored files from listings and diffs", async () => {
  writeFileSync(join(root, ".gitignore"), ".env.local\n");
  writeFileSync(join(root, ".env.local"), "OPENAI_API_KEY=secret\n");
  try {
    const listing = await listTrackedEntries(root, "");
    assert.ok(!listing.entries.some((entry) => entry.name === ".env.local" || entry.name === ".gitignore"));
    const diff = await readGitDiff(root, "");
    assert.equal(diff.patch, "");
    assert.ok(!diff.patch.includes("secret"));
  } finally {
    rmSync(join(root, ".gitignore"));
    rmSync(join(root, ".env.local"));
  }
});

test("truncates a long diff and keeps the stat summary", async () => {
  writeFileSync(join(root, "big.txt"), `${"строка изменения\n".repeat(2_000)}`);
  try {
    const diff = await readGitDiff(root, "big.txt");
    assert.equal(diff.truncated, true);
    assert.equal(diff.patch.length, PROJECT_MCP_LIMITS.maxDiffCharacters);
    assert.match(diff.stat, /big\.txt/);
    assert.match(diff.stat, /1 file changed/);
  } finally {
    git("checkout", "-q", "--", "big.txt");
  }
});

test("path arguments cannot leave the repository or use pathspec magic", () => {
  for (const path of ["../etc", "docs/../../x", "/etc/passwd", ":(glob)**", "--output=x", "docs\\x", "a\u0000b"]) {
    assert.equal(projectToolSchemas.list_files.safeParse({ path }).success, false, path);
  }
  assert.equal(projectToolSchemas.git_diff.safeParse({ path: "src/lib" }).success, true);
  assert.equal(projectToolSchemas.git_branch.safeParse({ extra: true }).success, false);
});

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const script = resolve("scripts/review-pr.ts");
const loader = resolve("node_modules/tsx/dist/loader.mjs");

test("local CLI produces a real report for an unchanged revision without a model call or GitHub writes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "flash-review-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  git("init", "-q"); git("config", "user.email", "test@example.com"); git("config", "user.name", "Test");
  await writeFile(join(root, "README.md"), "# Base\n"); git("add", "."); git("commit", "-qm", "base");
  const sha = git("rev-parse", "HEAD");
  const result = spawnSync(process.execPath, ["--conditions=react-server", "--import", loader, script, "--base", sha, "--head", sha, "--repository", "owner/repo"], {
    cwd: root, encoding: "utf8", env: { PATH: process.env.PATH, NODE_ENV: "test" },
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(join(root, "data/code-review/review.json"), "utf8"));
  assert.equal(report.snapshot.totalFiles, 0);
  assert.equal(report.indexId, null);
  assert.deepEqual(report.reviews, []);
  const markdown = await readFile(join(root, "data/code-review/review.md"), "utf8");
  assert.match(markdown, /0\/0/);
  assert.match(markdown, /Нет успешно проверенных файлов/);
  const invalid = spawnSync(process.execPath, ["--conditions=react-server", "--import", loader, script, "--base", sha], { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH, NODE_ENV: "test" } });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /--base.*--head/);
  await writeFile(join(root, "README.md"), "# Changed\n"); git("add", "."); git("commit", "-qm", "change");
  const head = git("rev-parse", "HEAD");
  const missingKey = spawnSync(process.execPath, ["--conditions=react-server", "--import", loader, script, "--base", sha, "--head", head, "--repository", "owner/repo"], {
    cwd: root, encoding: "utf8", env: { PATH: process.env.PATH, NODE_ENV: "test" },
  });
  assert.equal(missingKey.status, 1);
  const failure = JSON.parse(await readFile(join(root, "data/code-review/review.json"), "utf8"));
  assert.equal(failure.status, "failed");
  assert.equal(failure.headSha, head);
  assert.equal(failure.snapshot, undefined);
  assert.match(failure.reason, /OPENAI_API_KEY/);
});

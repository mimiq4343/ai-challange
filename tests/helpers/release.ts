import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReleaseAnalysis, ReleaseCi, ReleaseSnapshot } from "../../src/lib/release-types";

export const releaseSnapshot: ReleaseSnapshot = {
  repository: "owner/repo", baseRef: "refs/heads/main", headRef: "HEAD", baseSha: "a".repeat(40), headSha: "b".repeat(40),
  totalFiles: 2, commitsTruncated: false, commits: [{ id: "C1", sha: "b".repeat(40), subject: "fix: atomic save" }],
  files: [{ id: "F1", path: "src/store.ts", status: "M", side: "head", line: 2, patch: "@@ -1 +1 @@\n-save();\n+transaction(save);\n" }],
  skipped: [{ path: "large.json", reason: "Лимит размера" }],
};
export const releaseAnalysis: ReleaseAnalysis = {
  features: [], fixes: [{ text: "Сохранение использует транзакцию.", sourceIds: ["F1"] }], other: [],
  risks: [{ text: "Нужно проверить откат при ошибке записи.", sourceIds: ["F1"] }],
  checks: [{ text: "Проверить атомарное сохранение и откат.", sourceIds: ["F1"] }], limitations: [],
};
export const releaseCi: ReleaseCi = { state: "missing", message: "Запусков CI нет. Проверки не подтверждены.", checkedAt: "2026-10-18T00:00:00.000Z", runs: [] };

export async function releaseRepository(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "flash-release-flow-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  git("init", "-qb", "main"); git("config", "user.email", "test@example.com"); git("config", "user.name", "Test");
  git("remote", "add", "origin", "https://github.com/owner/repo.git");
  await mkdir(join(root, "src")); await mkdir(join(root, "docs"));
  await writeFile(join(root, "src/store.ts"), "export const answer = 1;\n");
  git("add", "."); git("commit", "-qm", "base"); git("switch", "-qc", "release");
  await writeFile(join(root, "src/store.ts"), "export const answer = 2;\n");
  git("add", "."); git("commit", "-qm", "feat: change answer");
  return { root, git };
}

import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { collectReviewSnapshot, readReviewWorkspace } from "./code-review-git";
import { RELEASE_CONFIG as CONFIG } from "./release-config";
import { ReleaseError, releaseSnapshotSchema, type ReleaseWorkspace, type ReleaseSnapshot } from "./release-types";

const execFileAsync = promisify(execFile);
async function git(root: string, args: string[], signal?: AbortSignal) {
  const { stdout } = await execFileAsync("git", ["-C", root, "--no-pager", ...args], {
    signal, timeout: CONFIG.gitTimeoutMs, maxBuffer: CONFIG.gitMaxBufferBytes,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout.trim();
}

export async function readReleaseWorkspace(root: string, signal?: AbortSignal): Promise<ReleaseWorkspace> {
  const [workspace, tags] = await Promise.all([
    readReviewWorkspace(root, signal),
    git(root, ["for-each-ref", `--count=${CONFIG.maxTags}`, "--sort=-creatordate", "--format=%(refname)", "refs/tags"], signal),
  ]);
  for (const ref of tags.split("\n").filter(Boolean)) {
    // Теги могут указывать на tree/blob; в списке выбора допустимы только коммиты.
    const type = await git(root, ["cat-file", "-t", `${ref}^{}`], signal);
    if (type !== "commit") continue;
    const sha = await git(root, ["rev-parse", "--verify", `${ref}^{commit}`], signal);
    workspace.branches.push({ ref, label: `tag · ${ref.slice("refs/tags/".length)}`, sha });
  }
  return workspace;
}

export async function collectReleaseSnapshot(root: string, workspace: ReleaseWorkspace, baseRef: string, headRef: string, signal: AbortSignal): Promise<ReleaseSnapshot> {
  const base = workspace.branches.find(ref => ref.ref === baseRef);
  const head = workspace.branches.find(ref => ref.ref === headRef);
  if (!base || !head) throw new ReleaseError("Ветка или тег не найдены. Обновите список refs.");
  if (base.sha === head.sha) throw new ReleaseError("Коммиты совпадают: нет изменений для релиза.");
  const ancestor = await git(root, ["merge-base", base.sha, head.sha], signal);
  if (ancestor !== base.sha) throw new ReleaseError("База должна быть предком релиза. Выберите предыдущий тег или коммит из истории целевой ветки.");
  const [snapshot, log] = await Promise.all([
    collectReviewSnapshot(root, base.sha, head.sha, signal),
    git(root, ["log", `--max-count=${CONFIG.maxCommits + 1}`, "--format=%H%x00%s", `${base.sha}..${head.sha}`, "--"], signal),
  ]);
  const entries = log.split("\n").filter(Boolean);
  return releaseSnapshotSchema.parse({
    repository: workspace.repository, baseRef, headRef, baseSha: base.sha, headSha: head.sha,
    totalFiles: snapshot.totalFiles, skipped: snapshot.skipped, commitsTruncated: entries.length > CONFIG.maxCommits,
    commits: entries.slice(0, CONFIG.maxCommits).map((entry, index) => {
      const delimiter = entry.indexOf("\0");
      if (delimiter < 0) throw new ReleaseError("Git вернул некорректный журнал коммитов.", 502);
      return { id: `C${index + 1}`, sha: entry.slice(0, delimiter), subject: entry.slice(delimiter + 1) };
    }),
    files: snapshot.files.map((file, index) => ({ id: `F${index + 1}`, path: file.path, status: file.status, patch: file.patch, side: file.side, line: file.changedLines[0] ?? null })),
  });
}

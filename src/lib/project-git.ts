import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PROJECT_MCP_LIMITS as LIMITS } from "./dev-assistant-config";
import type { ProjectFileStatus, ProjectToolOutput } from "./project-tool-schemas";

const execFileAsync = promisify(execFile);

export class ProjectGitError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProjectGitError";
  }
}

// Только чтение: optional locks выключены, внешние diff/textconv не запускаются,
// пути передаются литерально после «--».
async function git(root: string, args: readonly string[], signal?: AbortSignal): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, "--no-pager", "--literal-pathspecs", ...args], {
      encoding: "utf8",
      timeout: LIMITS.gitTimeoutMs,
      maxBuffer: LIMITS.gitMaxBufferBytes,
      signal,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
    });
    return stdout;
  } catch (cause) {
    signal?.throwIfAborted();
    throw new ProjectGitError(`Команда git ${args[0]} завершилась ошибкой.`, { cause });
  }
}

type StatusSnapshot = {
  branch: string | null; head: string | null; upstream: string | null;
  ahead: number | null; behind: number | null; files: ProjectFileStatus[];
};

// Формат `git status --porcelain=v2 --branch -z`: заголовки «# branch.*», затем записи.
export function parsePorcelainStatus(output: string): StatusSnapshot {
  const snapshot: StatusSnapshot = { branch: null, head: null, upstream: null, ahead: null, behind: null, files: [] };
  const entries = output.split("\0");
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) continue;
    if (entry.startsWith("# ")) {
      const [key, ...rest] = entry.slice(2).split(" ");
      const value = rest.join(" ");
      if (key === "branch.oid") snapshot.head = value === "(initial)" ? null : value;
      else if (key === "branch.head") snapshot.branch = value === "(detached)" ? null : value;
      else if (key === "branch.upstream") snapshot.upstream = value;
      else if (key === "branch.ab") {
        const match = /^\+(\d+) -(\d+)$/.exec(value);
        if (!match) throw new ProjectGitError("git status вернул некорректный заголовок branch.ab.");
        snapshot.ahead = Number(match[1]);
        snapshot.behind = Number(match[2]);
      }
      continue;
    }
    const fields = entry.split(" ");
    const xy = fields[1] ?? "";
    if (entry.startsWith("1 ") && fields.length >= 9) {
      snapshot.files.push({ path: fields.slice(8).join(" "), kind: "changed", index: xy[0], worktree: xy[1] });
    } else if (entry.startsWith("2 ") && fields.length >= 10) {
      const from = entries[index + 1];
      if (from === undefined) throw new ProjectGitError("git status вернул неполную запись переименования.");
      index += 1;
      snapshot.files.push({ path: fields.slice(9).join(" "), kind: "renamed", index: xy[0], worktree: xy[1], from });
    } else if (entry.startsWith("u ") && fields.length >= 11) {
      snapshot.files.push({ path: fields.slice(10).join(" "), kind: "unmerged", index: xy[0], worktree: xy[1] });
    } else if (entry.startsWith("? ")) {
      snapshot.files.push({ path: entry.slice(2), kind: "untracked", index: "?", worktree: "?" });
    } else if (!entry.startsWith("! ")) {
      throw new ProjectGitError("git status вернул запись неизвестного формата.");
    }
  }
  return snapshot;
}

export async function readGitBranch(root: string, signal?: AbortSignal): Promise<ProjectToolOutput<"git_branch">> {
  const status = parsePorcelainStatus(await git(root, ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=no"], signal));
  let lastCommit: ProjectToolOutput<"git_branch">["lastCommit"] = null;
  if (status.head) {
    const [subject, committedAt] = (await git(root, ["log", "-1", "--format=%s%x00%cI", "HEAD"], signal)).replace(/\n$/, "").split("\0");
    lastCommit = { subject, committedAt };
  }
  return {
    branch: status.branch, detached: status.branch === null, head: status.head?.slice(0, 12) ?? null,
    upstream: status.upstream, ahead: status.ahead, behind: status.behind, lastCommit,
  };
}

export async function readGitStatus(root: string, signal?: AbortSignal): Promise<ProjectToolOutput<"git_status">> {
  const status = parsePorcelainStatus(await git(root, ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=normal"], signal));
  return {
    branch: status.branch, clean: status.files.length === 0, total: status.files.length,
    truncated: status.files.length > LIMITS.maxStatusFiles, files: status.files.slice(0, LIMITS.maxStatusFiles),
  };
}

// Непосредственное содержимое каталога среди отслеживаемых файлов, как `ls` по индексу git.
export async function listTrackedEntries(root: string, path: string, signal?: AbortSignal): Promise<ProjectToolOutput<"list_files">> {
  const files = (await git(root, ["ls-files", "-z", "--full-name", "--", path || "."], signal)).split("\0").filter(Boolean);
  if (path && files.length === 0) throw new ProjectGitError(`Путь ${path} не найден среди отслеживаемых файлов.`);
  if (path && files.length === 1 && files[0] === path) {
    return { path, totalFiles: 1, truncated: false, entries: [{ name: path.split("/").at(-1)!, type: "file", files: 1 }] };
  }
  const prefix = path ? `${path}/` : "";
  const directories = new Map<string, number>();
  const plain: string[] = [];
  for (const file of files) {
    if (!file.startsWith(prefix)) continue;
    const rest = file.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash === -1) plain.push(rest);
    else directories.set(rest.slice(0, slash), (directories.get(rest.slice(0, slash)) ?? 0) + 1);
  }
  const entries = [
    ...[...directories].sort(([left], [right]) => left.localeCompare(right)).map(([name, count]) => ({ name, type: "directory" as const, files: count })),
    ...plain.sort((left, right) => left.localeCompare(right)).map((name) => ({ name, type: "file" as const, files: 1 })),
  ];
  return { path, totalFiles: files.length, truncated: entries.length > LIMITS.maxListEntries, entries: entries.slice(0, LIMITS.maxListEntries) };
}

export async function readGitDiff(root: string, path: string, signal?: AbortSignal): Promise<ProjectToolOutput<"git_diff">> {
  const common = ["--no-ext-diff", "--no-textconv", "--no-color", "HEAD", "--", path || "."];
  const [stat, patch] = await Promise.all([
    git(root, ["diff", "--stat=200", ...common], signal),
    git(root, ["diff", "-U3", ...common], signal),
  ]);
  const truncated = patch.length > LIMITS.maxDiffCharacters;
  return { base: "HEAD", path, stat: stat.trimEnd(), patch: truncated ? patch.slice(0, LIMITS.maxDiffCharacters) : patch, truncated };
}

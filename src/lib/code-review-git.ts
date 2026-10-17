import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { CODE_REVIEW_CONFIG as CONFIG } from "./code-review-config";
import type { ReviewFile, ReviewSnapshot } from "./code-review-types";
import type { CorpusDocument } from "./document-types";

const execFileAsync = promisify(execFile);

function assertSha(sha: string): void {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha)) throw new Error("Нужен полный SHA коммита.");
}

export async function fetchReviewHead(root: string, number: number, headSha: string, token: string, signal?: AbortSignal): Promise<void> {
  assertSha(headSha);
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(number) || number < 1 || !token) throw new Error("Нужны номер PR и GITHUB_TOKEN.");
  // Секрет только в окружении дочернего процесса, никогда в аргументах Git.
  await execFileAsync("git", ["-C", root, "fetch", "--no-tags", "--no-recurse-submodules", "origin", `refs/pull/${number}/head`], {
    timeout: CONFIG.gitTimeoutMs, maxBuffer: CONFIG.gitMaxBufferBytes, signal,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}` },
  });
  const fetched = (await git(root, ["rev-parse", "FETCH_HEAD^{commit}"], signal)).toString("utf8").trim();
  if (fetched !== headSha) throw new Error("PR уже изменился: полученный head SHA не соответствует событию. Дождитесь нового запуска.");
}

// PR никогда не checkout-ится: читаем объекты Git, выключив внешние diff/textconv.
async function git(root: string, args: string[], signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted();
  const { stdout } = await execFileAsync("git", ["-C", root, "--no-pager", "--literal-pathspecs", ...args], {
    encoding: "buffer", timeout: CONFIG.gitTimeoutMs, maxBuffer: CONFIG.gitMaxBufferBytes, signal,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
  });
  return stdout;
}

type TreeFile = { path: string; mode: string; size: number };

async function tree(root: string, sha: string, signal?: AbortSignal): Promise<Map<string, TreeFile>> {
  const entries = (await git(root, ["ls-tree", "-r", "-l", "-z", sha], signal)).toString("utf8").split("\0").filter(Boolean);
  return new Map(entries.map((entry) => {
    const tab = entry.indexOf("\t");
    const [mode, , , size] = entry.slice(0, tab).trim().split(/\s+/);
    const path = entry.slice(tab + 1);
    return [path, { path, mode, size: Number(size) }];
  }));
}

function textBlob(bytes: Buffer): string | null {
  if (bytes.includes(0)) return null;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return null; }
}

function safePath(path: string): boolean {
  return !path.split("/").some((part) => part === ".." || part.startsWith(".env") || part === "data" || part === "node_modules")
    && /(?:\.(?:tsx?|jsx?|mjs|cjs|md|json|ya?ml|css)|(?:^|\/)\.gitignore)$/.test(path);
}

function changedLines(patch: string, side: ReviewFile["side"], content: string): number[] {
  const result = new Set<number>();
  const lastLine = content ? content.split("\n").length - (content.endsWith("\n") ? 1 : 0) : 0;
  let line = 0;
  let inHunk = false;
  for (const entry of patch.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(entry);
    if (hunk) { line = Number(hunk[side === "base" ? 1 : 2]); inHunk = true; continue; }
    if (!inHunk || entry.startsWith("\\")) continue;
    if (entry.startsWith(side === "base" ? "-" : "+")) result.add(line++);
    // Удаление может не добавить ни одной строки. Якорь — следующая строка
    // head или его последняя сохранившаяся строка при удалении в конце файла.
    else if (side === "head" && entry.startsWith("-") && lastLine > 0) result.add(Math.min(line, lastLine));
    else if (entry.startsWith(" ")) line++;
  }
  return [...result].sort((a, b) => a - b);
}

export async function collectReviewSnapshot(root: string, baseSha: string, headSha: string, signal?: AbortSignal): Promise<ReviewSnapshot> {
  assertSha(baseSha); assertSha(headSha);
  const mergeBaseSha = (await git(root, ["merge-base", baseSha, headSha], signal)).toString("utf8").trim();
  assertSha(mergeBaseSha);
  const [baseTree, headTree, names] = await Promise.all([
    tree(root, mergeBaseSha, signal), tree(root, headSha, signal),
    git(root, ["diff", "--no-ext-diff", "--no-textconv", "--find-renames", "--name-status", "-z", mergeBaseSha, headSha], signal),
  ]);
  const snapshot: ReviewSnapshot = { baseSha, headSha, mergeBaseSha, totalFiles: 0, files: [], skipped: [] };
  const records = names.toString("utf8").split("\0").filter(Boolean);
  let characters = 0;
  for (let i = 0; i < records.length;) {
    const status = records[i++];
    const previous = records[i++];
    const path = /^[RC]/.test(status) ? records[i++] : previous;
    snapshot.totalFiles++;
    const skip = (reason: string) => snapshot.skipped.push({ path, reason });
    if (!path || !previous) throw new Error("Git вернул неполный список изменений.");
    if (!safePath(path) || !safePath(previous)) { skip("Путь исключён из отправки модели или формат не поддерживается."); continue; }
    const side = status === "D" || (status === "M" && headTree.get(path)?.size === 0 && baseTree.has(path)) ? "base" : "head";
    const file = (side === "base" ? baseTree : headTree).get(path);
    if (!file || !/^100(?:644|755)$/.test(file.mode)) { skip("Ссылка, submodule или неподдерживаемый тип файла."); continue; }
    if (file.size > CONFIG.maxFileBytes) { skip(`Размер превышает лимит ${CONFIG.maxFileBytes} байт.`); continue; }
    if (snapshot.files.length >= CONFIG.maxFiles) { skip(`Достигнут лимит ${CONFIG.maxFiles} файлов за запуск.`); continue; }
    const content = textBlob(await git(root, ["cat-file", "blob", `${side === "base" ? mergeBaseSha : headSha}:${path}`], signal));
    if (content === null) { skip("Файл бинарный или содержит некорректный UTF-8."); continue; }
    const patch = (await git(root, ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--find-renames", "--unified=5", mergeBaseSha, headSha, "--", ...new Set([previous, path])], signal)).toString("utf8");
    if (patch.length > CONFIG.maxPatchCharacters) { skip(`Diff превышает лимит ${CONFIG.maxPatchCharacters} символов.`); continue; }
    if (characters + patch.length + content.length > CONFIG.maxSnapshotCharacters) { skip("Достигнут общий лимит контекста файлов."); continue; }
    characters += patch.length + content.length;
    snapshot.files.push({ path, ...(path !== previous ? { previousPath: previous } : {}), status, side, content, patch, changedLines: changedLines(patch, side, content) });
  }
  return snapshot;
}

// Корпус берётся из точного base SHA, а не из рабочего дерева или инструкций PR.
export async function loadReviewCorpus(root: string, sha: string, signal?: AbortSignal): Promise<CorpusDocument[]> {
  assertSha(sha);
  const documents: CorpusDocument[] = [];
  let characters = 0;
  for (const file of (await tree(root, sha, signal)).values()) {
    const source = file.path;
    const selected = source === "README.md" || source === "AGENTS.md" || /^docs\/.*\.md$/.test(source) || /^src\/.*\.tsx?$/.test(source);
    if (!selected || !/^100(?:644|755)$/.test(file.mode)) continue;
    if (file.size > CONFIG.maxCorpusFileBytes) throw new Error(`Файл корпуса превышает лимит: ${source}.`);
    const text = textBlob(await git(root, ["cat-file", "blob", `${sha}:${source}`], signal));
    if (text === null) throw new Error(`Файл корпуса содержит бинарные данные или некорректный UTF-8: ${source}.`);
    if (!text.trim()) continue;
    characters += text.length;
    if (characters > CONFIG.maxCorpusCharacters) throw new Error("Корпус ревью превышает лимит символов.");
    documents.push({ source, title: source, text, sourceHash: createHash("sha256").update(text).digest("hex") });
  }
  if (!documents.some((file) => file.source.endsWith(".md")) || !documents.some((file) => /\.tsx?$/.test(file.source))) {
    throw new Error("RAG-корпус должен содержать документацию и код.");
  }
  return documents;
}

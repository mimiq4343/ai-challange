import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FILE_ASSISTANT_CONFIG as CONFIG } from "./file-assistant-config";
import { PROJECT_MCP_LIMITS } from "./dev-assistant-config";
import { FileAssistantError } from "./file-assistant-types";

export const fileHash = (content: string) => createHash("sha256").update(content).digest("hex");

export function fileGit(root: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", root, "--no-pager", "--literal-pathspecs", ...args], {
      encoding: "utf8", timeout: PROJECT_MCP_LIMITS.gitTimeoutMs, maxBuffer: PROJECT_MCP_LIMITS.gitMaxBufferBytes,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" }, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (cause) { throw new FileAssistantError("Не удалось прочитать состояние git проекта.", 500, { cause }); }
}

export function validateFilePath(path: string, write = false): void {
  const segments = path.split("/");
  if (!path || path.length > 300 || /[\p{Cc}\\]/u.test(path) || segments.some(part => !part || part.startsWith(".")) || path.startsWith("-") || path.startsWith(":")) {
    throw new FileAssistantError("Нужен относительный путь внутри проекта без скрытых каталогов и '..'.");
  }
  const base = segments.at(-1)!;
  if (/secret|credential|private[-_]?key|\.pem$|\.key$/i.test(base)) throw new FileAssistantError("Файлы с секретами недоступны.", 403);
  const markdown = path === "README.md" || /^docs\/.+\.md$/.test(path);
  if (write) {
    if (!markdown || /^(AGENTS|CLAUDE|SKILL)\.md$/i.test(base)) throw new FileAssistantError("Запись разрешена только в README.md и документацию docs/*.md; файлы инструкций защищены.", 403);
    return;
  }
  if (markdown || path === "AGENTS.md" || /^(package|tsconfig)\.json$|^(next|eslint|postcss)\.config\.(ts|mjs|js)$/.test(path)) return;
  if (/^(src|scripts|tests)\/.+\.(ts|tsx|js|jsx|mjs|cjs|json|css)$/.test(path)) return;
  throw new FileAssistantError("Этот путь недоступен файловому ассистенту.", 403);
}

/** Проверяет каждый компонент; символические ссылки и специальные файлы закрыты. */
export function safeFilePath(root: string, path: string, createParents = false): string {
  let current = realpathSync(root);
  const segments = path.split("/");
  for (let index = 0; index < segments.length; index++) {
    current = join(current, segments[index]);
    let stat;
    try { stat = lstatSync(current); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      if (index < segments.length - 1 && createParents) { mkdirSync(current); continue; }
      if (index < segments.length - 1) return resolve(current, ...segments.slice(index + 1));
      return current;
    }
    if (stat.isSymbolicLink()) throw new FileAssistantError("Символические ссылки недоступны.", 403);
    if (index < segments.length - 1 && !stat.isDirectory()) throw new FileAssistantError("Компонент пути не является каталогом.");
    if (index === segments.length - 1 && (!stat.isFile() || stat.nlink !== 1)) throw new FileAssistantError("Ожидается обычный файл без дополнительных жёстких ссылок.", 403);
  }
  return current;
}

export function readProjectText(root: string, path: string): { content: string; hash: string; mode: number } | null {
  const absolute = safeFilePath(root, path);
  let fd: number;
  try { fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) throw new FileAssistantError("Ожидается обычный файл.", 403);
    if (stat.size > CONFIG.maxFileBytes) throw new FileAssistantError(`Файл превышает ${CONFIG.maxFileBytes} байт.`, 413);
    const bytes = readFileSync(fd);
    if (bytes.length > CONFIG.maxFileBytes || bytes.includes(0)) throw new FileAssistantError("Файл слишком большой или содержит двоичные данные.");
    let content: string;
    try { content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch (cause) { throw new FileAssistantError("Файл не является текстом UTF-8.", 400, { cause }); }
    return { content, hash: fileHash(content), mode: stat.mode & 0o777 };
  } finally { closeSync(fd); }
}

export function createFilePatch(path: string, before: string | null, after: string): string {
  const directory = mkdtempSync(join(tmpdir(), "flash-file-diff-"));
  try {
    writeFileSync(join(directory, "before"), before ?? "");
    writeFileSync(join(directory, "after"), after);
    const diff = spawnSync("git", ["--no-pager", "diff", "--no-index", "--no-ext-diff", "--no-textconv", "--no-color", "--", before === null ? "/dev/null" : "before", "after"], {
      cwd: directory, encoding: "utf8", timeout: PROJECT_MCP_LIMITS.gitTimeoutMs, maxBuffer: PROJECT_MCP_LIMITS.gitMaxBufferBytes,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_OPTIONAL_LOCKS: "0" },
    });
    if (diff.error || (diff.status !== 0 && diff.status !== 1)) throw new FileAssistantError("Не удалось подготовить diff.", 500, { cause: diff.error });
    let inHunk = false;
    const patch = diff.stdout.split("\n").map(line => {
      if (line.startsWith("@@")) inHunk = true;
      if (inHunk) return line;
      if (line.startsWith("diff --git ")) return `diff --git a/${path} b/${path}`;
      if (line.startsWith("--- ")) return `--- ${before === null ? "/dev/null" : `a/${path}`}`;
      if (line.startsWith("+++ ")) return `+++ b/${path}`;
      return line;
    }).join("\n");
    if (patch.length > CONFIG.maxPatchCharacters) throw new FileAssistantError("Diff слишком большой. Подготовьте меньшее изменение.", 413);
    return patch;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

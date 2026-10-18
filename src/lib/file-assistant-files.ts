import { randomUUID } from "node:crypto";
import { linkSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FILE_ASSISTANT_CONFIG as CONFIG } from "./file-assistant-config";
import { createFilePatch, fileGit, fileHash, readProjectText, safeFilePath, validateFilePath } from "./file-assistant-io";
import { FileProposalStore } from "./file-assistant-store";
import { FileAssistantError, fileProposalSchema, fileToolSchemas, type FileEdit } from "./file-assistant-types";

export class ProjectFiles {
  private readonly root: string;
  private readonly reads = new Map<string, string>();
  constructor(root: string) { this.root = realpathSync(root); }

  private paths(): string[] {
    return [...new Set(fileGit(this.root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean))]
      .filter(path => {
        try { validateFilePath(path); return true; }
        catch (cause) { if (cause instanceof FileAssistantError) return false; throw cause; }
      }).sort();
  }

  read(path: string, startLine = 1, endLine?: number) {
    fileToolSchemas.read_file.parse({ path, startLine, endLine });
    validateFilePath(path);
    if (!this.paths().includes(path)) throw new FileAssistantError("Файл не найден среди доступных файлов проекта.", 404);
    const file = readProjectText(this.root, path);
    if (!file) throw new FileAssistantError("Файл отсутствует в рабочей копии.", 404);
    const lines = file.content.split("\n");
    if (startLine > lines.length || (endLine !== undefined && endLine < startLine)) throw new FileAssistantError("Недопустимый диапазон строк.");
    const last = Math.min(endLine ?? lines.length, lines.length, startLine + CONFIG.maxReadLines - 1);
    const selected: string[] = [];
    let characters = 0;
    for (let index = startLine - 1; index < last; index++) {
      const needed = lines[index].length + (selected.length ? 1 : 0);
      if (characters + needed > CONFIG.maxReadCharacters) {
        if (!selected.length) throw new FileAssistantError("Строка слишком длинная для чтения.", 413);
        break;
      }
      selected.push(lines[index]); characters += needed;
    }
    this.reads.set(path, file.hash);
    const actualEnd = startLine + selected.length - 1;
    return { path, content: selected.join("\n"), hash: file.hash, startLine, endLine: actualEnd, totalLines: lines.length,
      truncated: actualEnd < Math.min(endLine ?? lines.length, lines.length) };
  }

  search(query: string, path = "") {
    fileToolSchemas.search_files.parse({ query, path });
    if (path && (path.split("/").some(part => !part || part.startsWith(".")) || /[\\\p{Cc}]/u.test(path))) throw new FileAssistantError("Недопустимый путь поиска.");
    const paths = this.paths().filter(file => !path || file === path || file.startsWith(`${path}/`));
    const matches: { path: string; line: number; text: string; truncated: boolean }[] = [];
    const skipped: { path: string; reason: string }[] = [];
    let scannedFiles = 0;
    let truncated = paths.length > CONFIG.maxSearchFiles;
    for (const filePath of paths.slice(0, CONFIG.maxSearchFiles)) {
      let file;
      try { file = readProjectText(this.root, filePath); }
      catch (cause) {
        if (!(cause instanceof FileAssistantError)) throw cause;
        skipped.push({ path: filePath, reason: cause.message }); continue;
      }
      if (!file) { skipped.push({ path: filePath, reason: "Файл удалён из рабочей копии." }); continue; }
      scannedFiles++;
      const lines = file.content.split("\n");
      for (let index = 0; index < lines.length; index++) {
        if (!lines[index].includes(query)) continue;
        if (matches.length === CONFIG.maxSearchMatches) { truncated = true; break; }
        const position = lines[index].indexOf(query);
        const start = Math.max(0, position - 100);
        const text = lines[index].slice(start, start + CONFIG.maxLineCharacters);
        matches.push({ path: filePath, line: index + 1, text, truncated: text.length !== lines[index].length });
      }
      if (matches.length === CONFIG.maxSearchMatches) { truncated = true; break; }
    }
    return { query, path, scannedFiles, totalFiles: paths.length, matches, skipped, truncated };
  }

  propose(path: string, baseHash: string | null, change: string | FileEdit[]) {
    fileToolSchemas.propose_file.parse({ path, baseHash, ...(typeof change === "string" ? { content: change } : { edits: change }) });
    validateFilePath(path, true);
    if (baseHash !== null && this.reads.get(path) !== baseHash) throw new FileAssistantError("Перед изменением нужно прочитать целевой файл в этом запросе.");
    const current = readProjectText(this.root, path);
    if ((current?.hash ?? null) !== baseHash) throw new FileAssistantError("Файл изменился или уже существует. Прочитайте его заново.", 409);
    let content: string;
    if (typeof change === "string") content = change;
    else {
      if (!current) throw new FileAssistantError("Для нового файла передайте content.");
      content = current.content;
      for (const edit of change) {
        const first = content.indexOf(edit.oldText);
        if (first === -1 || content.indexOf(edit.oldText, first + 1) !== -1) throw new FileAssistantError("oldText должен встречаться ровно один раз. Добавьте контекст из файла.");
        content = content.slice(0, first) + edit.newText + content.slice(first + edit.oldText.length);
      }
    }
    if (!content.trim() || content.includes("\0")) throw new FileAssistantError("Нужно непустое текстовое содержимое.");
    if (Buffer.byteLength(content) > CONFIG.maxFileBytes) throw new FileAssistantError("Результат превышает лимит размера файла.", 413);
    if (current?.content === content) throw new FileAssistantError("Содержимое не изменилось.");
    const branch = fileGit(this.root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    const head = fileGit(this.root, ["rev-parse", "HEAD"]).trim();
    const patch = createFilePatch(path, current?.content ?? null, content);
    const store = new FileProposalStore(this.root);
    try { return store.save({ path, baseHash, content, patch, root: this.root, branch, head }); }
    finally { store.close(); }
  }
}

/** Применяет только сохранённое сервером содержимое; браузер передаёт один ID. */
export function applyFileProposal(root: string, id: string) {
  const canonicalRoot = realpathSync(root);
  const store = new FileProposalStore(canonicalRoot);
  let temporary: string | undefined;
  try {
    store.database.exec("BEGIN IMMEDIATE");
    try {
      const proposal = store.read(id);
      validateFilePath(proposal.path, true);
      if (proposal.root !== canonicalRoot || proposal.branch !== fileGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim() || proposal.head !== fileGit(root, ["rev-parse", "HEAD"]).trim()) {
        throw new FileAssistantError("Ветка или HEAD изменились. Подготовьте новое предложение.", 409);
      }
      const current = readProjectText(canonicalRoot, proposal.path);
      if (proposal.status === "applied") {
        if (current?.hash !== fileHash(proposal.content)) throw new FileAssistantError("После применения файл изменился.", 409);
        store.database.exec("COMMIT");
        return fileProposalSchema.parse(proposal);
      }
      if (Date.now() > Date.parse(proposal.expiresAt)) throw new FileAssistantError("Срок предложения истёк. Подготовьте его заново.", 409);
      // Повтор после сбоя между rename и COMMIT восстанавливает подтверждение записи.
      if (current?.hash !== fileHash(proposal.content)) {
        if ((current?.hash ?? null) !== proposal.baseHash) throw new FileAssistantError("Файл изменился после подготовки diff. Прочитайте его заново.", 409);
        const target = safeFilePath(canonicalRoot, proposal.path, true);
        temporary = join(dirname(target), `.flash-files-${randomUUID()}.tmp`);
        writeFileSync(temporary, proposal.content, { flag: "wx", mode: current?.mode ?? 0o644 });
        // Повторная проверка непосредственно перед атомарной заменой.
        if ((readProjectText(canonicalRoot, proposal.path)?.hash ?? null) !== proposal.baseHash) throw new FileAssistantError("Файл изменился перед записью.", 409);
        if (proposal.baseHash === null) { linkSync(temporary, target); unlinkSync(temporary); }
        else renameSync(temporary, target);
        temporary = undefined;
      }
      const applied = store.markApplied(proposal);
      store.database.exec("COMMIT");
      return applied;
    } catch (cause) { store.database.exec("ROLLBACK"); throw cause; }
  } finally {
    if (temporary) unlinkSync(temporary);
    store.close();
  }
}

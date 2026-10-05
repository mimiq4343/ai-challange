import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { DOCUMENT_INDEX_CONFIG } from "./document-config";
import manifest from "./document-corpus-manifest.json";
import type { CorpusDocument, DocumentCorpus } from "./document-types";

export async function loadDocumentCorpus(
  root: string,
  sources: readonly string[] = manifest,
): Promise<DocumentCorpus> {
  if (!root || sources.length === 0 || new Set(sources).size !== sources.length) {
    throw new Error("Корпус должен содержать непустой список уникальных файлов.");
  }
  const directory = await realpath(root);
  const documents: CorpusDocument[] = [];
  let characters = 0;
  let lines = 0;
  for (const source of [...sources].sort()) {
    if (isAbsolute(source) || source.split(/[\\/]/).includes("..") || !/\.(md|ts)$/.test(source)) {
      throw new Error(`Недопустимый путь корпуса: ${source}.`);
    }
    const file = await realpath(resolve(directory, source));
    const inside = relative(directory, file);
    if (inside.startsWith(`..${sep}`) || inside === ".." || isAbsolute(inside)) {
      throw new Error(`Файл корпуса выходит за пределы проекта: ${source}.`);
    }
    const info = await stat(file);
    if (!info.isFile() || info.size > DOCUMENT_INDEX_CONFIG.maxFileBytes) {
      throw new Error(`Файл корпуса слишком большой или не является обычным файлом: ${source}.`);
    }
    const bytes = await readFile(file);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    if (!text.trim()) throw new Error(`Файл корпуса пуст: ${source}.`);
    characters += text.length;
    lines += text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    if (characters > DOCUMENT_INDEX_CONFIG.maxCorpusCharacters) throw new Error("Корпус превышает допустимый объём.");
    const heading = source.endsWith(".md") ? /^ {0,3}#\s+(.+?)(?:\s+#+)?\s*$/m.exec(text) : null;
    documents.push({
      source,
      title: heading ? heading[1] : basename(source),
      text,
      sourceHash: createHash("sha256").update(text).digest("hex"),
    });
  }
  return {
    documents,
    hash: createHash("sha256").update(JSON.stringify(documents.map(({ source, sourceHash }) => ({ source, sourceHash })))).digest("hex"),
    characters,
    lines,
    estimatedPages: Math.ceil(characters / DOCUMENT_INDEX_CONFIG.charactersPerPage),
    charactersPerPage: DOCUMENT_INDEX_CONFIG.charactersPerPage,
  };
}

import { createHash } from "node:crypto";
import ts from "typescript";
import { DOCUMENT_INDEX_CONFIG } from "./document-config";
import type { ChunkStrategy, CorpusDocument, DocumentChunk, DocumentSection } from "./document-types";

type TokenCounter = (text: string) => Promise<number>;
type Boundary = { start: number; title: string };

function markdownBoundaries(document: CorpusDocument): Boundary[] {
  const boundaries: Boundary[] = [{ start: 0, title: document.title }];
  const headings: string[] = [];
  let offset = 0;
  let fence: { character: string; length: number } | null = null;
  for (const line of document.text.split(/(?<=\n)/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
    } else if (marker) {
      fence = { character: marker[1][0], length: marker[1].length };
    } else {
      const heading = /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
      if (heading) {
        headings.length = heading[1].length - 1;
        headings.push(heading[2]);
        const boundary = { start: offset, title: headings.filter(Boolean).join(" / ") };
        if (offset === 0) boundaries[0] = boundary;
        else boundaries.push(boundary);
      }
    }
    offset += line.length;
  }
  return boundaries;
}

function typescriptBoundaries(document: CorpusDocument): Boundary[] {
  const file = ts.createSourceFile(document.source, document.text, ts.ScriptTarget.Latest, true);
  const boundaries: Boundary[] = [];
  for (const node of file.statements) {
    const name = "name" in node && node.name && ts.isIdentifier(node.name as ts.Node)
      ? (node.name as ts.Identifier).text : ts.SyntaxKind[node.kind];
    boundaries.push({ start: node.getFullStart(), title: name });
    if (ts.isClassDeclaration(node)) {
      for (const member of node.members) {
        const memberName = member.name?.getText(file) ?? (ts.isConstructorDeclaration(member) ? "constructor" : ts.SyntaxKind[member.kind]);
        boundaries.push({ start: member.getFullStart(), title: `${name}.${memberName}` });
      }
      if (node.members.length) boundaries.push({ start: node.members.at(-1)!.getEnd(), title: `${name} / конец класса` });
    }
  }
  if (!boundaries.length) return [{ start: 0, title: document.title }];
  boundaries[0].start = 0;
  return boundaries;
}

export function documentSections(document: CorpusDocument): DocumentSection[] {
  const boundaries = document.source.endsWith(".md") ? markdownBoundaries(document) : typescriptBoundaries(document);
  return boundaries.map((boundary, index) => ({
    ...boundary,
    end: boundaries[index + 1]?.start ?? document.text.length,
  })).filter(({ start, end }) => end > start);
}

function safeOffset(text: string, offset: number): number {
  const code = text.charCodeAt(offset);
  return code >= 0xdc00 && code <= 0xdfff ? offset - 1 : offset;
}

async function windowEnd(text: string, start: number, limit: number, maxTokens: number, count: TokenCounter): Promise<number> {
  let upper = safeOffset(text, Math.min(limit, start + maxTokens * 32));
  while (upper < limit && await count(text.slice(start, upper)) <= maxTokens) {
    upper = safeOffset(text, Math.min(limit, start + (upper - start) * 2));
  }
  if (await count(text.slice(start, upper)) <= maxTokens) return upper;
  let lower = start;
  while (lower + 1 < upper) {
    const middle = safeOffset(text, Math.floor((lower + upper) / 2));
    if (middle <= lower) break;
    if (await count(text.slice(start, middle)) <= maxTokens) lower = middle;
    else upper = middle;
  }
  if (lower <= start) throw new Error("Размер чанка слишком мал для одного символа исходника.");
  return lower;
}

async function overlapStart(text: string, start: number, end: number, tokens: number, count: TokenCounter): Promise<number> {
  if (tokens === 0) return end;
  let lower = start;
  let upper = end;
  while (lower + 1 < upper) {
    const middle = safeOffset(text, Math.floor((lower + upper) / 2));
    if (middle <= lower) break;
    if (await count(text.slice(middle, end)) <= tokens) upper = middle;
    else lower = middle;
  }
  return upper;
}

export async function chunkDocuments(
  documents: readonly CorpusDocument[],
  strategy: ChunkStrategy,
  countTokens: TokenCounter,
  options: { maxTokens: number; overlapTokens: number } = DOCUMENT_INDEX_CONFIG,
): Promise<DocumentChunk[]> {
  const { maxTokens, overlapTokens } = options;
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0 || !Number.isSafeInteger(overlapTokens) || overlapTokens < 0 || overlapTokens >= maxTokens) {
    throw new Error("Нужен положительный размер чанка и меньшее неотрицательное перекрытие.");
  }
  if (strategy !== "fixed" && strategy !== "structural") throw new Error("Неизвестная стратегия чанкинга.");
  const chunks: DocumentChunk[] = [];
  for (const document of documents) {
    const sections = documentSections(document);
    const ranges = strategy === "structural" ? sections : [{ start: 0, end: document.text.length, title: document.title }];
    for (const range of ranges) {
      let start = range.start;
      while (start < range.end) {
        const end = await windowEnd(document.text, start, range.end, maxTokens, countTokens);
        const text = document.text.slice(start, end);
        const intersected = sections.filter((section) => section.start < end && section.end > start);
        const tokenCount = await countTokens(text);
        if (tokenCount > maxTokens) throw new Error("Чанк превышает заданный лимит токенов.");
        if (text.trim()) chunks.push({
          chunkId: createHash("sha256").update(JSON.stringify([document.source, document.sourceHash, strategy, start, end])).digest("hex"),
          strategy,
          source: document.source,
          title: document.title,
          section: strategy === "structural" ? range.title : intersected.map((section) => section.title).join(" → "),
          text,
          sourceHash: document.sourceHash,
          contentHash: createHash("sha256").update(text).digest("hex"),
          start,
          end,
          startLine: document.text.slice(0, start).split("\n").length,
          endLine: document.text.slice(0, end - 1).split("\n").length,
          tokenCount,
          boundaryCrossings: Math.max(0, intersected.length - 1),
        });
        if (end === range.end) break;
        const next = await overlapStart(document.text, start, end, overlapTokens, countTokens);
        start = Math.max(next, start + (document.text.codePointAt(start)! > 0xffff ? 2 : 1));
      }
    }
  }
  return chunks;
}

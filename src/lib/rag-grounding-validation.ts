import { RagError } from "./rag-agent";
import { fromMarkdown } from "mdast-util-from-markdown";
import { GROUNDING_CONFIG } from "./rag-grounding-config";
import type { GroundedQuote } from "./rag-grounding-types";
import type { RagSource } from "./rag-types";

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) throw new RagError("Неверная структура ответа с цитатами.", 502);
  return value as Record<string, unknown>;
}

function withoutMarkdownCode(answer: string): string {
  type Node = { type: string; position?: { start: { offset?: number }; end: { offset?: number } }; children?: Node[] };
  const fragments: string[] = [];
  let cursor = 0;
  function visit(node: Node) {
    if (node.type === "code" || node.type === "inlineCode") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) throw new RagError("Markdown-парсер не вернул позиции фрагмента кода.", 502);
      fragments.push(answer.slice(cursor, start), " ");
      cursor = end;
      return;
    }
    node.children?.forEach(visit);
  }
  visit(fromMarkdown(answer));
  return fragments.join("") + answer.slice(cursor);
}

export function parseGroundedAnswer(text: string, context: RagSource[]) {
  let decoded: unknown;
  try { decoded = JSON.parse(text); }
  catch (cause) { throw new RagError("LLM вернула недействительный JSON ответа с цитатами.", 502, { cause }); }
  const value = object(decoded, ["status", "answer", "clarification", "sources", "quotes"]);
  if (typeof value.answer !== "string" || !value.answer.trim() || !Array.isArray(value.sources) || !Array.isArray(value.quotes)) throw new RagError("Нужны непустой ответ и массивы sources и quotes.", 502);
  const answer = value.answer.trim();
  const cited = [...new Set(Array.from(withoutMarkdownCode(answer).matchAll(/\[(S\d+)\]/g), (match) => match[1]))];
  if (value.status === "unknown") {
    if (!/не знаю/i.test(answer) || value.sources.length || value.quotes.length || cited.length || typeof value.clarification !== "string" || !value.clarification.trim() || value.clarification.length > GROUNDING_CONFIG.maxClarificationCharacters || !value.clarification.includes("?") || /\[S\d+\]/.test(value.clarification)) throw new RagError("Отказ должен содержать «Не знаю», уточняющий вопрос и пустые источники и цитаты.", 502);
    return { status: "unknown" as const, answer, clarification: value.clarification.trim(), sources: [] as RagSource[], quotes: [] as GroundedQuote[], citations: [] as string[] };
  }
  if (value.status !== "answered" || value.clarification !== null || !value.sources.length || !value.quotes.length || value.sources.length > context.length || value.quotes.length > GROUNDING_CONFIG.maxQuotes) throw new RagError("Подтверждённый ответ требует источники и цитаты допустимого объёма.", 502);
  const known = new Map(context.map((source) => [source.id, source]));
  const sources: RagSource[] = [];
  const sourceIds = new Set<string>();
  for (const row of value.sources) {
    const source = object(row, ["id", "source", "section", "chunkId"]);
    const actual = typeof source.id === "string" ? known.get(source.id) : undefined;
    if (!actual || sourceIds.has(actual.id) || source.source !== actual.source || source.section !== actual.section || source.chunkId !== actual.chunkId) throw new RagError("Источник не совпадает с найденным чанком или указан повторно.", 502);
    sourceIds.add(actual.id);
    sources.push(actual);
  }
  if (!cited.length || cited.length !== sourceIds.size || cited.some((id) => !sourceIds.has(id))) throw new RagError("Все ссылки ответа должны вести к указанным источникам, каждый источник должен использоваться.", 502);
  const quotes: GroundedQuote[] = [];
  const quotedIds = new Set<string>();
  const seenQuotes = new Set<string>();
  for (const row of value.quotes) {
    const quote = object(row, ["sourceId", "text"]);
    const actual = typeof quote.sourceId === "string" ? known.get(quote.sourceId) : undefined;
    if (!actual || !sourceIds.has(actual.id) || typeof quote.text !== "string" || quote.text.trim().length < GROUNDING_CONFIG.minQuoteCharacters || quote.text.length > GROUNDING_CONFIG.maxQuoteCharacters || !actual.text.includes(quote.text)) throw new RagError("Цитата отсутствует в указанном чанке, слишком короткая или превышает допустимый объём.", 502);
    const key = JSON.stringify([actual.id, quote.text]);
    if (seenQuotes.has(key)) throw new RagError("Цитата указана повторно.", 502);
    seenQuotes.add(key);
    quotedIds.add(actual.id);
    quotes.push({ sourceId: actual.id, chunkId: actual.chunkId, text: quote.text });
  }
  if (sources.some((source) => !quotedIds.has(source.id))) throw new RagError("Для каждого использованного источника нужна цитата.", 502);
  return { status: "answered" as const, answer, clarification: null, sources, quotes, citations: cited };
}

import { RagError } from "./rag-agent";
import { RAG_CHAT_CONFIG } from "./rag-chat-config";
import { GROUNDING_CONFIG } from "./rag-grounding-config";

export type QuoteOption = { id: string; text: string };

export function quoteOptions(text: string): QuoteOption[] {
  const fragments = [text, ...text.split(/\n\s*\n/)];
  for (let start = 0; start < text.length; start += GROUNDING_CONFIG.maxQuoteCharacters - RAG_CHAT_CONFIG.quoteOverlapCharacters) fragments.push(text.slice(start, start + GROUNDING_CONFIG.maxQuoteCharacters));
  return [...new Set(fragments)].filter((fragment) => fragment.trim().length >= GROUNDING_CONFIG.minQuoteCharacters && fragment.length <= GROUNDING_CONFIG.maxQuoteCharacters)
    .map((fragment, index) => ({ id: `Q${index + 1}`, text: fragment }));
}

export function resolveQuoteSelection(text: string, sources: { id: string; quoteOptions: QuoteOption[] }[]): string {
  let value;
  try { value = JSON.parse(text); }
  catch (cause) { throw new RagError("LLM вернула недействительный JSON выбора цитат.", 502, { cause }); }
  if (!value || typeof value !== "object" || !Array.isArray(value.quotes)) throw new RagError("Неверная структура выбора цитат.", 502);
  value.quotes = value.quotes.map((row: unknown) => {
    if (!row || typeof row !== "object" || Object.keys(row).length !== 2 || !("sourceId" in row) || !("quoteId" in row)) throw new RagError("Выбор цитаты требует sourceId и quoteId.", 502);
    const quote = sources.find((source) => source.id === row.sourceId)?.quoteOptions.find((option) => option.id === row.quoteId);
    if (!quote) throw new RagError("Выбрана отсутствующая цитата или источник.", 502);
    return { sourceId: row.sourceId, text: quote.text };
  });
  return JSON.stringify(value);
}

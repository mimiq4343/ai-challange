import type { McpToolResult } from "./mcp-chat-types";
import { projectToolOutputSchemas, type DocsSearchResult } from "./project-tool-schemas";

type Trace = { name: string; result?: McpToolResult };

/** Источники ответа — все фрагменты успешных search_docs текущего /help. */
export function collectDocsSources(traces: readonly Trace[]): { sources: DocsSearchResult[]; stale: boolean } {
  const sources: DocsSearchResult[] = [];
  let stale = false;
  for (const trace of traces) {
    if (trace.name !== "search_docs" || !trace.result || trace.result.isError) continue;
    const parsed = projectToolOutputSchemas.search_docs.safeParse(trace.result.structuredContent);
    if (!parsed.success) continue;
    stale ||= parsed.data.stale;
    for (const result of parsed.data.results) if (!sources.some(({ id }) => id === result.id)) sources.push(result);
  }
  return { sources, stale };
}

/** Ссылки вида [S1] в ответе: подтверждённые найденными фрагментами и неизвестные. */
export function answerCitations(answer: string, sources: readonly DocsSearchResult[]): { cited: string[]; unknown: string[] } {
  const ids = [...new Set(Array.from(answer.matchAll(/\[(S\d+)\]/g), (match) => match[1]))];
  const known = new Set(sources.map(({ id }) => id));
  return { cited: ids.filter((id) => known.has(id)), unknown: ids.filter((id) => !known.has(id)) };
}

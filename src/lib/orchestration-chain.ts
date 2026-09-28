import * as z from "zod/v4";

import { ChatAgentError } from "./chat-agent";
import type { McpToolResult } from "./mcp-chat-types";
import { orchestrationToolName } from "./orchestration-tools";

export const searchLink = z.object({ searchResultId: z.uuid() });
export const summaryLink = z.object({ summaryId: z.uuid(), searchResultId: z.uuid() });
export const reportLink = z.object({ reportId: z.uuid(), summaryId: z.uuid(), searchResultId: z.uuid(), downloadUrl: z.string() });

const SEARCH = orchestrationToolName("pipeline", "search_repositories");
const SUMMARIZE = orchestrationToolName("pipeline", "summarize_repositories");
const SAVE = orchestrationToolName("pipeline", "save_to_file");

/**
 * Провенанс идентификаторов одного запуска оркестрации. Модель выбирает порядок
 * вызовов сама, но зависимый шаг принимает только идентификатор, полученный
 * от успешного предыдущего шага этого же запуска.
 */
export class OrchestrationChain {
  private readonly searchIds = new Set<string>();
  private readonly summaryIds = new Set<string>();
  readonly downloadUrls: string[] = [];

  /** Причина отказа до выполнения, понятная модели, или null. */
  rejectionFor(name: string, args: Record<string, unknown>): string | null {
    if (name === SUMMARIZE && !this.searchIds.has(String(args.searchResultId))) {
      return "searchResultId не получен от search_repositories в этом запросе. Сначала выполни поиск и возьми идентификатор из его результата.";
    }
    if (name === SAVE && !this.summaryIds.has(String(args.summaryId))) {
      return "summaryId не получен от summarize_repositories в этом запросе. Сначала составь обзор и возьми идентификатор из его результата.";
    }
    return null;
  }

  /** Запоминает идентификаторы успешного шага; несвязный ответ собственного сервера — нарушение протокола. */
  record(name: string, args: Record<string, unknown>, result: McpToolResult): void {
    if (result.isError) return;
    if (name === SEARCH) {
      const link = searchLink.safeParse(result.structuredContent);
      if (!link.success) throw new ChatAgentError("Поиск не вернул идентификатор сохранённого результата.", "upstream");
      this.searchIds.add(link.data.searchResultId);
    } else if (name === SUMMARIZE) {
      const link = summaryLink.safeParse(result.structuredContent);
      if (!link.success || link.data.searchResultId !== args.searchResultId) {
        throw new ChatAgentError("Обзор не связан с результатом поиска этого запроса.", "upstream");
      }
      this.summaryIds.add(link.data.summaryId);
    } else if (name === SAVE) {
      const link = reportLink.safeParse(result.structuredContent);
      if (!link.success || link.data.summaryId !== args.summaryId || !this.searchIds.has(link.data.searchResultId) ||
          link.data.downloadUrl !== `/api/pipeline/reports/${link.data.reportId}`) {
        throw new ChatAgentError("Сохранённый отчёт не связан с обзором этого запроса или содержит недопустимую ссылку.", "upstream");
      }
      if (!this.downloadUrls.includes(link.data.downloadUrl)) this.downloadUrls.push(link.data.downloadUrl);
    }
  }
}

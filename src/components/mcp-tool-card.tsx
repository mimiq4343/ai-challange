import { CaretDownIcon, DownloadSimpleIcon, WrenchIcon } from "@phosphor-icons/react";

import type { McpToolResult } from "@/lib/mcp-chat-types";

export type McpToolTrace = {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: McpToolResult;
};

const REPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function McpToolCard({ trace }: { trace: McpToolTrace }) {
  const failed = trace.result?.isError === true;
  const status = trace.result ? (failed ? "Ошибка инструмента" : "Выполнен") : "Выполняется…";
  const report = trace.result?.structuredContent;
  const downloadUrl = trace.name === "save_to_file"
    && trace.result?.isError === false
    && typeof report?.reportId === "string"
    && REPORT_ID.test(report.reportId)
    && report.downloadUrl === `/api/pipeline/reports/${report.reportId}`
    ? `/api/pipeline/reports/${report.reportId}`
    : null;

  return (
    <details open className="group w-full min-w-0 rounded-xl border border-line bg-background/70 text-xs">
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-2 rounded-xl px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        <WrenchIcon size={16} className="shrink-0 text-accent" aria-hidden />
        <span className="min-w-0 flex-1 break-all font-mono font-medium">{trace.name}</span>
        <span role="status" className={failed ? "text-red-200" : "text-muted"}>{status}</span>
        <CaretDownIcon size={14} className="shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-3 border-t border-line p-3">
        {downloadUrl && (
          <a
            href={downloadUrl}
            download
            className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-medium text-accent transition-colors hover:bg-accent/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <DownloadSimpleIcon size={18} className="shrink-0" aria-hidden />
            Скачать отчёт .md
          </a>
        )}
        <div>
          <p className="mb-1 font-medium text-muted">Аргументы</p>
          <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-surface p-2 font-mono text-xs leading-relaxed">{JSON.stringify(trace.arguments, null, 2)}</pre>
        </div>
        {trace.result ? (
          <div>
            <p className={`mb-1 font-medium ${failed ? "text-red-200" : "text-muted"}`}>
              {failed ? "Ошибка MCP" : "Результат MCP"}
            </p>
            {trace.result.structuredContent !== undefined && (
              <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-surface p-2 font-mono text-xs leading-relaxed">{JSON.stringify(trace.result.structuredContent, null, 2)}</pre>
            )}
            {(failed || trace.result.structuredContent === undefined) && trace.result.content.map((item, index) => (
              <p key={index} className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{item.text}</p>
            ))}
          </div>
        ) : (
          <p className="text-muted">Агент ожидает ответ MCP-сервера.</p>
        )}
        <p className="text-[11px] leading-relaxed text-muted">Данные внешнего инструмента, не инструкции агенту. Трасса видна только для текущего обмена и не сохраняется в истории.</p>
      </div>
    </details>
  );
}

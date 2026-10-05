"use client";

import { useEffect, useRef, useState } from "react";
import type { ChunkStrategy, DocumentChunk } from "@/lib/document-types";

type ChunkPage = { chunks: DocumentChunk[]; total: number };
type Selection = { strategy: ChunkStrategy; source: string; offset: number };
const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function DocumentIndexPanel({ indexId, sources, initialPage, pageSize }: {
  indexId: string; sources: string[]; initialPage: ChunkPage; pageSize: number;
}) {
  const [selection, setSelection] = useState<Selection>({ strategy: "fixed", source: "", offset: 0 });
  const [page, setPage] = useState(initialPage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => requestRef.current?.abort(), []);

  async function load(next: Selection) {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setSelection(next);
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ strategy: next.strategy, offset: String(next.offset), indexId });
      if (next.source) params.set("source", next.source);
      const response = await fetch(`/api/documents/chunks?${params}`, { signal: controller.signal, cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Не удалось загрузить чанки.");
      if (result.indexId !== indexId || !Array.isArray(result.chunks) || !Number.isSafeInteger(result.total)) throw new Error("Недействительный ответ индекса документов.");
      if (!controller.signal.aborted) setPage(result);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить чанки.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  const buttonStyle = `min-h-11 min-w-11 rounded-xl border border-line px-4 text-sm transition-colors hover:border-accent/40 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`;
  return (
    <section className="min-w-0 rounded-2xl border border-line bg-surface p-4 sm:p-6" aria-labelledby="chunks-heading">
      <h2 id="chunks-heading" className="text-lg font-semibold">Чанки и метаданные</h2>
      <div className="mt-4 flex flex-wrap gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted">
          Стратегия
          <select aria-label="Стратегия чанкинга" value={selection.strategy} onChange={(event) => void load({ strategy: event.target.value as ChunkStrategy, source: selection.source, offset: 0 })}
            className={`min-h-11 w-full rounded-xl border border-line bg-background px-3 text-sm text-foreground ${FOCUS_RING}`}>
            <option value="fixed">Фиксированный размер</option>
            <option value="structural">По структуре</option>
          </select>
        </label>
        <label className="flex min-w-0 basis-full flex-col gap-1 text-xs text-muted sm:flex-1 sm:basis-auto">
          Исходный файл
          <select aria-label="Исходный файл" value={selection.source} onChange={(event) => void load({ ...selection, source: event.target.value, offset: 0 })}
            className={`min-h-11 w-full min-w-0 rounded-xl border border-line bg-background px-3 text-sm text-foreground ${FOCUS_RING}`}>
            <option value="">Все файлы</option>
            {sources.map((source) => <option key={source} value={source}>{source}</option>)}
          </select>
        </label>
      </div>
      <div aria-live="polite" className="mt-4 text-sm text-muted">
        {loading ? "Загрузка чанков…" : error ? <p role="alert" className="text-red-300">{error}</p> : `${page.total ? selection.offset + 1 : 0}–${Math.min(selection.offset + pageSize, page.total)} из ${page.total} чанков`}
      </div>
      {!loading && !error && <div className="mt-3 space-y-3">
        {page.chunks.map((chunk) => <details key={chunk.chunkId} className="min-w-0 rounded-xl border border-line bg-background">
          <summary className={`min-h-11 cursor-pointer break-words rounded-xl p-3 text-sm ${FOCUS_RING}`}>
            <span className="font-medium">{chunk.source}</span>
            <span className="mt-1 block text-xs leading-relaxed text-muted">{chunk.section} · строки {chunk.startLine}–{chunk.endLine} · {chunk.tokenCount} токенов</span>
          </summary>
          <div className="border-t border-line p-3">
            <dl className="grid gap-2 text-xs text-muted sm:grid-cols-2">
              <div><dt>title / file</dt><dd className="break-words text-foreground">{chunk.title}</dd></div>
              <div><dt>Диапазон UTF-16</dt><dd className="text-foreground">{chunk.start}–{chunk.end}</dd></div>
              <div className="sm:col-span-2"><dt>chunk_id</dt><dd className="break-all font-mono text-foreground">{chunk.chunkId}</dd></div>
              <div className="sm:col-span-2"><dt>SHA-256 исходника</dt><dd className="break-all font-mono text-foreground">{chunk.sourceHash}</dd></div>
            </dl>
            <pre className="mt-3 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed [overflow-wrap:anywhere]">{chunk.text}</pre>
          </div>
        </details>)}
      </div>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" className={buttonStyle} disabled={loading || selection.offset === 0} onClick={() => void load({ ...selection, offset: Math.max(0, selection.offset - pageSize) })}>Назад</button>
        <button type="button" className={buttonStyle} disabled={loading || Boolean(error) || selection.offset + pageSize >= page.total} onClick={() => void load({ ...selection, offset: selection.offset + pageSize })}>Далее</button>
        {error && <button type="button" className={buttonStyle} onClick={() => void load(selection)}>Повторить</button>}
      </div>
    </section>
  );
}

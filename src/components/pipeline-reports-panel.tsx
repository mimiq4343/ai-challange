"use client";

import { useEffect, useId, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DownloadSimpleIcon, FileTextIcon } from "@phosphor-icons/react";

import type { PipelineReport } from "@/lib/pipeline-types";

const BUTTON_CLASS =
  "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line px-3 py-2 text-xs font-medium transition-colors hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-40";

export function PipelineReportsPanel({
  initialReports, profileName,
}: {
  initialReports: PipelineReport[];
  profileName: string;
}) {
  const router = useRouter();
  const headingId = useId();
  const [refreshing, startTransition] = useTransition();

  useEffect(() => {
    function refreshOnFocus() {
      startTransition(() => router.refresh());
    }
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [router]);

  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-4 border-b border-line p-4 [overflow-wrap:anywhere]">
      <header className="flex items-start gap-3">
        <FileTextIcon size={22} className="mt-1 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-accent">Цепочка MCP-инструментов</p>
          <h2 id={headingId} className="mt-1 text-base font-semibold">Отчёты GitHub</h2>
          <p className="mt-1 text-xs text-muted">Профиль: {profileName}</p>
        </div>
      </header>
      <ol className="list-inside list-decimal space-y-2 rounded-xl border border-accent/20 bg-accent/5 p-3 text-xs leading-relaxed">
        <li>Поиск репозиториев GitHub по вашему запросу.</li>
        <li>Сводка найденного через DeepSeek.</li>
        <li>Сохранение точного текста сводки в файл .md.</li>
      </ol>
      <p className="text-xs leading-relaxed text-muted">
        Один запрос запускает все три шага. Аргументы и результаты MCP в чате показывают, как searchResultId и summaryId передаются между инструментами.
      </p>
      <p className="text-xs leading-relaxed text-muted">
        Уже сохранённый файл остаётся здесь после перезагрузки, отмены или ошибки ответа в чате. Перед повтором команды проверьте отчёты.
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Сохранённые файлы · {initialReports.length}</h3>
        <button
          type="button"
          className={BUTTON_CLASS}
          aria-disabled={refreshing}
          onClick={() => { if (!refreshing) startTransition(() => router.refresh()); }}
        >
          {refreshing ? "Обновляем…" : "Обновить"}
        </button>
      </div>
      <p role="status" className="text-xs leading-relaxed text-muted">
        {refreshing ? "Проверяем сохранённые отчёты…" : "Список обновляется после ответа, при возврате на страницу или по кнопке. Время — UTC."}
      </p>
      {initialReports.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-4 text-sm leading-relaxed text-muted">
          Отчётов пока нет. Попросите в чате: «Найди репозитории для изучения TypeScript, составь сводку и сохрани её в Markdown-файл».
        </div>
      ) : (
        <div className="space-y-3">
          {initialReports.map((report) => (
            <article key={report.reportId} className="min-w-0 space-y-3 rounded-xl border border-line p-3">
              <h4 className="text-sm font-semibold">{report.query}</h4>
              <p className="font-mono text-xs text-muted">{report.fileName}</p>
              <time dateTime={report.createdAt} title={report.createdAt} className="block text-xs text-muted">
                {report.createdAt.replace("T", " ").replace(/\.\d{3}Z$/, "")} UTC
              </time>
              <a
                href={`/api/pipeline/reports/${report.reportId}`}
                download
                className={`${BUTTON_CLASS} border-accent/30 bg-accent/10 text-accent hover:bg-accent/20`}
                aria-label={`Скачать отчёт .md: ${report.query}`}
              >
                <DownloadSimpleIcon size={18} className="shrink-0" aria-hidden />
                Скачать .md
              </a>
              <details className="min-w-0 border-t border-line">
                <summary className="min-h-11 cursor-pointer rounded-lg py-3 text-xs font-medium text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                  Идентификаторы цепочки
                </summary>
                <dl className="space-y-2 pb-2 font-mono text-xs">
                  <div><dt className="text-muted">searchResultId</dt><dd>{report.searchResultId}</dd></div>
                  <div><dt className="text-muted">summaryId</dt><dd>{report.summaryId}</dd></div>
                  <div><dt className="text-muted">reportId</dt><dd>{report.reportId}</dd></div>
                </dl>
              </details>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

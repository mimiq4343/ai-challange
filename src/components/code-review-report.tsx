import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CodeReviewReport, ReviewSnapshot } from "@/lib/code-review-types";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const CATEGORIES = [
  { category: "bug", title: "Потенциальные баги" },
  { category: "architecture", title: "Архитектурные проблемы" },
  { category: "recommendation", title: "Рекомендации" },
] as const;
const SEVERITY = { high: "Высокая", medium: "Средняя", low: "Низкая" };
const SEVERITY_COLOR = { high: "border-red-400/30 bg-red-400/10 text-red-300", medium: "border-amber-400/30 bg-amber-400/10 text-amber-300", low: "border-accent/30 bg-accent/10 text-accent" };

function blobLink(repository: string, sha: string, path: string, line?: number | null): string {
  return `https://github.com/${repository}/blob/${sha}/${path.split("/").map(encodeURIComponent).join("/")}${line ? `#L${line}` : ""}`;
}

export function ReviewDiff({ snapshot }: { snapshot: ReviewSnapshot }) {
  return <section className="min-w-0 space-y-3" aria-label="Изменённые файлы и diff">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-semibold">Изменённые файлы</h2>
      <p className="font-mono text-xs text-muted">{snapshot.mergeBaseSha.slice(0, 8)}…{snapshot.headSha.slice(0, 8)}</p>
    </div>
    {snapshot.totalFiles === 0 && <p className="rounded-xl border border-line p-4 text-sm text-muted">Между выбранными коммитами нет изменений.</p>}
    {snapshot.files.map((file, index) => <details key={file.path} open={index === 0} className="min-w-0 rounded-xl border border-line bg-background">
      <summary className={`min-h-11 cursor-pointer rounded-xl px-3 py-3 text-sm break-words [overflow-wrap:anywhere] ${FOCUS}`}>
        <span className="mr-2 rounded border border-line px-1.5 py-0.5 font-mono text-xs text-muted">{file.status}</span>
        <span className="font-mono">{file.path}</span>
        {file.previousPath && <span className="mt-1 block text-xs text-muted">Прежний путь: {file.previousPath}</span>}
      </summary>
      <pre className="max-h-[32rem] overflow-auto border-t border-line p-3 text-xs leading-relaxed" aria-label={`Diff ${file.path}`}><code>
        {file.patch.split("\n").map((line, lineIndex) => <span key={lineIndex} className={`block min-h-[1.5em] ${line.startsWith("+") ? "text-emerald-300" : line.startsWith("-") ? "text-red-300" : line.startsWith("@@") ? "text-accent" : "text-muted"}`}>{line || " "}</span>)}
      </code></pre>
      <details className="border-t border-line">
        <summary className={`min-h-11 cursor-pointer rounded-xl px-3 py-3 text-xs text-muted ${FOCUS}`}>Полный файл · {file.side === "base" ? "до изменения" : "после изменения"}</summary>
        <pre className="max-h-96 overflow-auto border-t border-line p-3 text-xs leading-relaxed"><code>{file.content || "Файл пуст."}</code></pre>
      </details>
    </details>)}
  </section>;
}

export function ReviewReport({ report, repository }: { report: CodeReviewReport; repository: string }) {
  const { reviews, snapshot } = report;
  const findings = reviews.flatMap((review) => review.findings.map((finding) => ({ ...finding, path: review.path, side: review.side, sources: review.sources })));
  const incomplete = reviews.length < snapshot.files.length;
  return <div className="min-w-0 space-y-6" aria-label="Результат AI-ревью">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
      <div><h2 className="text-lg font-semibold">Результат ревью</h2><p className="mt-1 text-xs text-muted">Проверено {reviews.length} из {snapshot.files.length} выбранных файлов · замечаний: {findings.length}</p><p className="mt-1 font-mono text-xs text-muted">База {snapshot.baseSha.slice(0, 8)} · проверен {snapshot.headSha.slice(0, 8)}</p></div>
      <span className={`rounded-full border px-3 py-1 text-xs ${incomplete || snapshot.skipped.length > 0 ? "border-amber-400/30 bg-amber-400/10 text-amber-300" : "border-accent/30 bg-accent/10 text-accent"}`}>
        {incomplete ? "Ревью выполнено частично" : snapshot.totalFiles === 0 ? "Нет изменений" : snapshot.files.length === 0 ? "Нет файлов для анализа" : snapshot.skipped.length > 0 ? "Есть пропущенные файлы" : "Анализ завершён"}
      </span>
    </div>
    {snapshot.totalFiles > 0 && reviews.length === 0 && <p role="alert" className="text-sm text-amber-300">Нет успешно проверенных файлов. Это не означает, что в изменениях нет проблем.</p>}
    {CATEGORIES.map(({ category, title }) => <section key={category} className="space-y-3" aria-label={title}>
      <h3 className="text-sm font-semibold">{title} <span className="ml-1 text-muted">{findings.filter((finding) => finding.category === category).length}</span></h3>
      {findings.filter((finding) => finding.category === category).map((finding, index) => <article key={`${finding.path}-${index}`} className="min-w-0 space-y-3 rounded-xl border border-line bg-background p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><h4 className="min-w-0 text-sm font-medium break-words [overflow-wrap:anywhere]">{finding.title}</h4><span className={`rounded-full border px-2 py-0.5 text-[11px] ${SEVERITY_COLOR[finding.severity]}`}>{SEVERITY[finding.severity]}</span></div>
        <a href={blobLink(repository, finding.side === "head" ? snapshot.headSha : snapshot.mergeBaseSha, finding.path, finding.line)} target="_blank" rel="noreferrer" className={`inline-flex min-h-11 max-w-full items-center rounded text-xs text-accent underline decoration-accent/30 underline-offset-4 break-all ${FOCUS}`}>{finding.path}{finding.line !== null ? `:${finding.line}` : " · файл целиком"}</a>
        <ReviewText>{finding.body}</ReviewText>
        <div><p className="mb-2 text-sm font-medium text-accent">Исправление</p><ReviewText>{finding.recommendation}</ReviewText></div>
        {finding.sourceIds.length > 0 && <p className="text-xs text-muted">Основание: {finding.sourceIds.join(", ")} в источниках файла {finding.path}.</p>}
      </article>)}
      {!findings.some((finding) => finding.category === category) && <p className="text-sm text-muted">{reviews.length > 0 ? "В проверенных файлах замечаний этой категории нет." : "Нет результатов анализа."}</p>}
    </section>)}
    {snapshot.skipped.length > 0 && <section className="space-y-2 rounded-xl border border-amber-400/25 bg-amber-400/5 p-4" aria-label="Не проверены">
      <h3 className="text-sm font-semibold text-amber-300">Не проверены · {snapshot.skipped.length}</h3>
      <ul className="space-y-2 text-xs leading-relaxed text-muted">{snapshot.skipped.map((file, index) => <li key={`${file.path}-${index}`} className="break-words [overflow-wrap:anywhere]"><span className="font-mono text-foreground">{file.path}</span> — {file.reason}</li>)}</ul>
    </section>}
    {reviews.some((review) => review.limitations.length > 0) && <section className="space-y-2" aria-label="Ограничения анализа">
      <h3 className="text-sm font-semibold">Ограничения анализа</h3>
      <ul className="space-y-2 text-xs leading-relaxed text-muted">{reviews.flatMap((review) => review.limitations.map((limitation, index) => <li key={`${review.path}-${index}`} className="break-words [overflow-wrap:anywhere]"><span className="font-mono text-foreground">{review.path}</span> — {limitation}</li>))}</ul>
    </section>}
    {reviews.some((review) => review.sources.length > 0) && <section className="space-y-3" aria-label="RAG-источники">
      <div><h3 className="text-sm font-semibold">RAG-источники</h3><p className="mt-1 text-xs text-muted">Документация и связанный код базовой ветки. ID источников относятся к одному проверенному файлу.</p></div>
      {reviews.filter((review) => review.sources.length > 0).map((review) => <details key={review.path} className="min-w-0 rounded-xl border border-line">
        <summary className={`min-h-11 cursor-pointer rounded-xl p-3 text-xs break-words [overflow-wrap:anywhere] ${FOCUS}`}><span className="font-mono">{review.path}</span><span className="text-muted"> · {review.sources.length} источников</span></summary>
        <div className="space-y-2 border-t border-line p-3">{review.sources.map((source) => <details key={source.id} className="min-w-0 rounded-lg border border-line bg-background">
          <summary className={`min-h-11 cursor-pointer rounded-lg p-3 text-xs leading-relaxed break-words [overflow-wrap:anywhere] ${FOCUS}`}>
            <span className="font-medium">[{source.id}] {source.source}</span><span className="mt-1 block text-muted">{source.section} · строки {source.startLine}–{source.endLine} · сходство {source.score.toFixed(3)}{review.findings.some((finding) => finding.sourceIds.includes(source.id)) ? " · использован в замечании" : ""}</span>
          </summary>
          <pre className="border-t border-line p-3 text-xs leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{source.text}</pre>
          <a className={`flex min-h-11 items-center rounded-lg px-3 text-xs text-accent ${FOCUS}`} href={blobLink(repository, snapshot.baseSha, source.source, source.startLine)} target="_blank" rel="noreferrer">Открыть источник в GitHub</a>
        </details>)}</div>
      </details>)}
    </section>}
  </div>;
}

function ReviewText({ children }: { children: string }) {
  return <div className="prose prose-sm prose-invert max-w-none min-w-0 break-words [overflow-wrap:anywhere] [&_pre]:max-w-full [&_pre]:overflow-x-auto">
    <ReactMarkdown remarkPlugins={[remarkGfm]} allowedElements={["p", "pre", "code", "ul", "ol", "li", "strong", "em", "br", "blockquote", "del"]} unwrapDisallowed skipHtml>{children}</ReactMarkdown>
  </div>;
}

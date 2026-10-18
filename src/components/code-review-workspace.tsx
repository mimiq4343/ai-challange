"use client";

import { ArrowClockwiseIcon, GitBranchIcon, PlayIcon, StopIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ReviewDiff, ReviewReport } from "@/components/code-review-report";
import { CODE_REVIEW_CONFIG } from "@/lib/code-review-config";
import type { CodeReviewReport, ReviewSnapshot, ReviewWorkspace } from "@/lib/code-review-types";
import { consumeCodeReviewStream } from "@/lib/code-review-web-stream";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const CARD = "min-w-0 rounded-2xl border border-line bg-surface p-4 sm:p-5";
const SELECT = `mt-2 min-h-11 w-full min-w-0 cursor-pointer rounded-xl border border-line bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
type Status = "idle" | "running" | "done" | "error" | "stopped";

async function fetchBranches(signal?: AbortSignal): Promise<ReviewWorkspace> {
  const response = await fetch("/api/code-review/branches", { signal, cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Список веток недоступен.");
  return payload as ReviewWorkspace;
}

export function CodeReviewWorkspace() {
  const [workspace, setWorkspace] = useState<ReviewWorkspace | null>(null);
  const [baseRef, setBaseRef] = useState("");
  const [headRef, setHeadRef] = useState("");
  const [loading, setLoading] = useState(true);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [snapshot, setSnapshot] = useState<ReviewSnapshot | null>(null);
  const [report, setReport] = useState<CodeReviewReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const [seconds, setSeconds] = useState(0);
  const [tab, setTab] = useState<"report" | "diff">("diff");
  const abortRef = useRef<AbortController | null>(null);
  const submitRef = useRef<HTMLButtonElement | null>(null);
  const running = status === "running";

  const applyWorkspace = useCallback((value: ReviewWorkspace) => {
    setWorkspace(value);
    setBaseRef((current) => value.branches.some((branch) => branch.ref === current) ? current : value.baseRef);
    setHeadRef((current) => value.branches.some((branch) => branch.ref === current) ? current : value.headRef);
    setLoading(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchBranches(controller.signal).then(applyWorkspace).catch((cause: unknown) => {
      if (!controller.signal.aborted) { setBranchError(cause instanceof Error ? cause.message : "Список веток недоступен."); setLoading(false); }
    });
    return () => controller.abort();
  }, [applyWorkspace]);
  useEffect(() => () => abortRef.current?.abort(), []);

  async function reloadBranches() {
    setLoading(true); setBranchError(null);
    try { applyWorkspace(await fetchBranches()); }
    catch (cause) { setBranchError(cause instanceof Error ? cause.message : "Список веток недоступен."); setLoading(false); }
  }

  async function run(event: FormEvent) {
    event.preventDefault();
    if (running || !workspace || !baseRef || !headRef) return;
    const controller = new AbortController();
    const started = performance.now();
    abortRef.current = controller;
    setStatus("running"); setSnapshot(null); setReport(null); setError(null); setProgress([]); setSeconds(0); setTab("diff");
    try {
      const response = await fetch("/api/code-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseRef, headRef }), signal: controller.signal });
      if (!response.ok || !response.body) {
        const payload = await response.json();
        throw new Error(typeof payload.error === "string" ? payload.error : `Сервер вернул HTTP ${response.status}.`);
      }
      await consumeCodeReviewStream(response.body, (item) => {
        if (item.type === "progress") setProgress((current) => [...current.slice(-79), item.message]);
        if (item.type === "snapshot") setSnapshot(item.snapshot);
        if (item.type === "result") { setReport(item.report); setSnapshot(item.report.snapshot); setTab("report"); }
      });
      setStatus("done");
    } catch (cause) {
      if (controller.signal.aborted) setStatus("stopped");
      else { setStatus("error"); setError(cause instanceof Error ? cause.message : "Не удалось выполнить ревью."); }
    } finally {
      setSeconds((performance.now() - started) / 1000);
      if (abortRef.current === controller) abortRef.current = null;
      submitRef.current?.focus();
    }
  }

  const selectedBase = workspace?.branches.find((branch) => branch.ref === baseRef);
  const selectedHead = workspace?.branches.find((branch) => branch.ref === headRef);
  const totalFindings = report?.reviews.reduce((count, review) => count + review.findings.length, 0) ?? 0;
  return <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(18rem,0.32fr)_minmax(0,1fr)]">
    <aside className="min-w-0 space-y-4">
      <section className={CARD} aria-label="Настройки ревью">
        <div className="flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><GitBranchIcon size={18} aria-hidden />Сравнение веток</h2><button type="button" aria-label="Обновить список веток" title="Обновить список веток" disabled={loading || running} onClick={() => void reloadBranches()} className={`flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-xl border border-line text-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS}`}><ArrowClockwiseIcon size={18} aria-hidden className={loading ? "animate-spin motion-reduce:animate-none" : ""} /></button></div>
        {workspace && <a href={`https://github.com/${workspace.repository}`} target="_blank" rel="noreferrer" className={`mt-1 inline-flex min-h-11 max-w-full items-center rounded text-xs text-accent break-all ${FOCUS}`}>{workspace.repository}</a>}
        {loading && <p role="status" className="mt-3 text-sm text-muted">Загружаю ветки…</p>}
        {branchError && <p role="alert" className="mt-3 text-sm text-red-300">{branchError}</p>}
        <form onSubmit={run} className="mt-4 space-y-4">
          <label className="block text-xs font-medium text-muted">Базовая ветка<select aria-label="Базовая ветка" value={baseRef} onChange={(event) => setBaseRef(event.target.value)} disabled={loading || running || !workspace} className={SELECT}>
            {!workspace && <option value="">Выберите ветку</option>}{workspace?.branches.map((branch) => <option key={branch.ref} value={branch.ref}>{branch.label}</option>)}
          </select>{selectedBase && <span className="mt-1.5 block font-mono text-[11px]">{selectedBase.sha.slice(0, 12)}</span>}</label>
          <label className="block text-xs font-medium text-muted">Проверяемая ветка<select aria-label="Проверяемая ветка" value={headRef} onChange={(event) => setHeadRef(event.target.value)} disabled={loading || running || !workspace} className={SELECT}>
            {!workspace && <option value="">Выберите ветку</option>}{workspace?.branches.map((branch) => <option key={branch.ref} value={branch.ref}>{branch.label}</option>)}
          </select>{selectedHead && <span className="mt-1.5 block font-mono text-[11px]">{selectedHead.sha.slice(0, 12)}</span>}</label>
          <p className="text-xs leading-relaxed text-muted">Будут проверены закоммиченные изменения относительно общей базы веток. Незакоммиченные правки в ревью не входят.</p>
          <button ref={submitRef} type="submit" disabled={loading || running || !workspace || !baseRef || !headRef} className={`flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS}`}><PlayIcon size={17} weight="fill" aria-hidden />{running ? "Выполняется ревью…" : "Запустить ревью"}</button>
          {running && <button type="button" onClick={() => abortRef.current?.abort()} className={`flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-line px-4 text-sm text-muted hover:text-foreground ${FOCUS}`}><StopIcon size={17} aria-hidden />Остановить ревью</button>}
        </form>
        <p className="mt-4 text-xs leading-relaxed text-muted">Результат появится здесь. Комментарий в GitHub при ручном запуске не публикуется.</p>
      </section>
      <section className={CARD} aria-label="Ход ревью">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Ход ревью</h2><span className="rounded-full border border-line px-2 py-1 font-mono text-[10px] text-muted">{CODE_REVIEW_CONFIG.model}</span></div>
        <p role="status" aria-live="polite" className="mt-3 text-sm text-muted break-words [overflow-wrap:anywhere]">{running ? progress.at(-1) ?? "Запускаю анализ…" : status === "done" ? "Отчёт готов." : status === "stopped" ? "Ревью остановлено. Полного отчёта нет." : status === "error" ? "Ревью завершилось ошибкой." : "Выберите ветки и запустите проверку."}</p>
        {running && <p className="mt-2 text-xs leading-relaxed text-muted">Индексация документации и кода может занять несколько минут.</p>}
        {error && <p role="alert" className="mt-3 text-sm leading-relaxed text-red-300">{error}</p>}
        {seconds > 0 && <p className="mt-2 text-xs text-muted">Время: {seconds.toFixed(1)} с</p>}
        {progress.length > 0 && <details className="mt-3 rounded-xl border border-line"><summary className={`min-h-11 cursor-pointer rounded-xl p-3 text-xs text-muted ${FOCUS}`}>Журнал анализа · {progress.length}</summary><ol className="max-h-72 space-y-2 overflow-y-auto border-t border-line p-3 text-xs leading-relaxed text-muted">{progress.map((message, index) => <li key={index} className="break-words [overflow-wrap:anywhere]">{message}</li>)}</ol></details>}
      </section>
    </aside>
    <section className={`${CARD} space-y-5`} aria-label="Область ревью" aria-busy={running}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <div className="flex gap-2" role="group" aria-label="Представление ревью">{[{ value: "diff", label: "Diff и файлы" }, { value: "report", label: "Результат ревью" }].map(({ value, label }) => <button type="button" key={value} aria-pressed={tab === value} onClick={() => setTab(value as "diff" | "report")} className={`min-h-11 cursor-pointer rounded-xl border px-3 text-xs font-medium transition-colors ${tab === value ? "border-accent/30 bg-accent/10 text-accent" : "border-line text-muted hover:text-foreground"} ${FOCUS}`}>{label}</button>)}</div>
        {snapshot && <p className="text-xs text-muted">Файлов: {snapshot.totalFiles}{report ? ` · замечаний: ${totalFindings}` : ""}</p>}
      </div>
      {tab === "diff" ? snapshot ? <ReviewDiff snapshot={snapshot} /> : <EmptyState running={running} /> : report && workspace ? <ReviewReport report={report} repository={workspace.repository} /> : <p className="py-10 text-sm text-muted">{running ? "Ассистент анализирует изменения. Результат появится после завершения ревью." : "Отчёт появится после запуска и завершения ревью."}</p>}
    </section>
  </div>;
}

function EmptyState({ running }: { running: boolean }) {
  return <div className="flex min-h-72 flex-col items-center justify-center gap-3 px-3 text-center">
    <div className="flex size-14 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent"><GitBranchIcon size={26} aria-hidden /></div>
    <h2 className="text-base font-semibold">{running ? "Собираю изменения" : "AI-ревью кода"}</h2>
    <p className="max-w-[55ch] text-sm leading-relaxed text-muted">{running ? "Diff и список файлов появятся здесь перед анализом." : "Выберите базовую и проверяемую ветки. Ассистент получит diff, найдёт контекст в документации и коде и подготовит замечания."}</p>
    {!running && <p className="text-xs leading-relaxed text-muted">Потенциальные баги · архитектурные проблемы · рекомендации</p>}
  </div>;
}

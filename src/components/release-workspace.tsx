"use client";

import { ArrowClockwiseIcon, ArrowDownIcon, GitBranchIcon, PlayIcon, StopIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileProposalCard } from "@/components/file-proposal-card";
import { RELEASE_CONFIG } from "@/lib/release-config";
import { consumeReleaseStream } from "@/lib/release-stream";
import { releaseWorkspaceSchema, type ReleaseCi, type ReleaseReport, type ReleaseSnapshot, type ReleaseWorkspace as Workspace } from "@/lib/release-types";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const CARD = "min-w-0 rounded-2xl border border-line bg-surface p-4 sm:p-5";
const SELECT = `mt-2 min-h-11 w-full min-w-0 cursor-pointer rounded-xl border border-line bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
const ciLabels = { success: "Запуски успешны", failed: "Есть ошибки CI", pending: "CI выполняется", missing: "Нет запусков CI", unavailable: "CI недоступен", partial: "CI подтверждён частично" };

async function fetchReleaseRefs(signal: AbortSignal): Promise<Workspace> {
  const response = await fetch("/api/release/refs", { signal, cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Список веток и тегов недоступен.");
  return releaseWorkspaceSchema.parse(payload);
}

function CiStatus({ ci }: { ci: ReleaseCi }) {
  const color = ci.state === "success" ? "border-emerald-400/25 text-emerald-300" : ci.state === "failed" ? "border-red-400/25 text-red-300" : "border-amber-300/25 text-amber-200";
  return <section className={`${CARD} space-y-3`} aria-label="Результаты GitHub Actions">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">GitHub Actions</h2><span className={`rounded-full border px-2.5 py-1 text-xs ${color}`}>{ciLabels[ci.state]}</span></div>
    <p className="text-xs leading-relaxed text-muted">{ci.message}</p>
    <p className="text-[11px] text-muted">Снимок на {new Date(ci.checkedAt).toLocaleString("ru-RU")}</p>
    {!!ci.runs.length && <ul className="space-y-1">{ci.runs.map(run => <li key={run.id}><a href={run.url} target="_blank" rel="noreferrer" className={`flex min-h-11 min-w-11 flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-xs hover:border-accent/40 ${FOCUS}`}><span className="break-words [overflow-wrap:anywhere]">{run.name}</span><span className="font-mono text-muted">{run.conclusion ?? run.status}</span></a></li>)}</ul>}
  </section>;
}

function SourceDiff({ snapshot }: { snapshot: ReleaseSnapshot }) {
  return <div className="min-w-0 space-y-3" aria-label="Исходные изменения релиза">
    <p className="text-xs leading-relaxed text-muted">Неизменяемый снимок Git. Локальные незакоммиченные правки не включены.</p>
    {snapshot.files.map(file => <details key={file.id} className="min-w-0 rounded-xl border border-line">
      <summary className={`min-h-11 cursor-pointer px-3 py-3 text-xs ${FOCUS}`}><span className="text-accent">{file.id}</span><span className="ml-2 break-all font-mono">{file.path}</span><span className="ml-2 text-muted">{file.status}</span></summary>
      <pre tabIndex={0} aria-label={`Diff ${file.path}`} className={`max-h-96 overflow-auto border-t border-line bg-background p-3 font-mono text-xs leading-relaxed ${FOCUS}`}>{file.patch}</pre>
    </details>)}
    {!!snapshot.skipped.length && <div className="rounded-xl border border-amber-300/20 p-3"><h3 className="text-xs font-medium text-amber-200">Не вошли в анализ</h3><ul className="mt-2 space-y-2 text-xs text-muted">{snapshot.skipped.map((file, index) => <li key={index} className="break-words [overflow-wrap:anywhere]"><span className="font-mono">{file.path}</span>: {file.reason}</li>)}</ul></div>}
    <details className="min-w-0 rounded-xl border border-line"><summary className={`min-h-11 cursor-pointer px-3 py-3 text-xs ${FOCUS}`}>Коммиты · {snapshot.commits.length}{snapshot.commitsTruncated ? "+" : ""}</summary><ul className="space-y-1 border-t border-line p-3">{snapshot.commits.map(commit => <li key={commit.id}><a href={`https://github.com/${snapshot.repository}/commit/${commit.sha}`} target="_blank" rel="noreferrer" className={`flex min-h-11 min-w-11 items-center gap-2 rounded-lg px-2 py-2 text-xs hover:bg-accent/10 ${FOCUS}`}><span className="shrink-0 font-mono text-accent">{commit.id}</span><span className="min-w-0 break-words [overflow-wrap:anywhere]">{commit.subject}</span></a></li>)}</ul></details>
  </div>;
}

export function ReleaseWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [baseRef, setBaseRef] = useState("");
  const [headRef, setHeadRef] = useState("");
  const [loading, setLoading] = useState(true);
  const [refsError, setRefsError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error" | "stopped">("idle");
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ReleaseSnapshot | null>(null);
  const [ci, setCi] = useState<ReleaseCi | null>(null);
  const [report, setReport] = useState<ReleaseReport | null>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const [view, setView] = useState<"notes" | "diff">("notes");
  const abortRef = useRef<AbortController | null>(null);
  const refsAbort = useRef<AbortController | null>(null);
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  const running = status === "running";

  function loadRefs(signal: AbortSignal) {
    return fetchReleaseRefs(signal).then(value => {
      setWorkspace(value);
      setBaseRef(current => value.branches.some(branch => branch.ref === current) ? current : value.baseRef);
      setHeadRef(current => value.branches.some(branch => branch.ref === current) ? current : value.headRef);
    }).catch((cause: unknown) => {
      if (!signal.aborted) setRefsError(cause instanceof Error ? cause.message : "Список веток и тегов недоступен.");
    }).finally(() => { if (!signal.aborted) setLoading(false); });
  }

  useEffect(() => {
    const controller = new AbortController();
    refsAbort.current = controller;
    void loadRefs(controller.signal);
    return () => { refsAbort.current?.abort(); abortRef.current?.abort(); };
  }, []);

  async function run(event: FormEvent) {
    event.preventDefault();
    if (running || !workspace) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("running"); setError(null); setSnapshot(null); setCi(null); setReport(null); setProgress([]); setView("notes");
    try {
      const response = await fetch("/api/release", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseRef, headRef }), signal: controller.signal });
      if (!response.ok || !response.body) {
        const payload = await response.json();
        throw new Error(typeof payload.error === "string" ? payload.error : `Сервер вернул HTTP ${response.status}.`);
      }
      await consumeReleaseStream(response.body, event => {
        if (event.type === "progress") setProgress(current => [...current.slice(-19), event.message]);
        if (event.type === "snapshot") setSnapshot(event.snapshot);
        if (event.type === "ci") setCi(event.ci);
        if (event.type === "result") { setReport(event.report); setSnapshot(event.report.snapshot); setCi(event.report.ci); }
      });
      setStatus("done");
    } catch (cause) {
      if (controller.signal.aborted) setStatus("stopped");
      else { setStatus("error"); setError(cause instanceof Error ? cause.message : "Не удалось подготовить релиз."); }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      statusRef.current?.focus();
    }
  }

  const base = workspace?.branches.find(branch => branch.ref === baseRef);
  const head = workspace?.branches.find(branch => branch.ref === headRef);
  const sameCommit = !!base && !!head && base.sha === head.sha;
  const statusText = running ? progress.at(-1) ?? "Подготовка…" : status === "done" ? "Отчёт подготовлен" : status === "stopped" ? "Подготовка остановлена. Полный отчёт не создан." : status === "error" ? "Не удалось завершить подготовку" : "Выберите диапазон изменений";

  return <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(17rem,0.7fr)_minmax(0,2fr)]">
    <aside className="min-w-0 space-y-4">
      <form onSubmit={event => void run(event)} className={`${CARD} space-y-4`} aria-label="Подготовка релиза">
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold">Новый релиз</h2><p className="mt-1 break-all font-mono text-[11px] text-muted">{workspace?.repository ?? "Подключаю репозиторий…"}</p></div><button type="button" disabled={loading || running} onClick={() => { refsAbort.current?.abort(); setLoading(true); setRefsError(null); const controller = new AbortController(); refsAbort.current = controller; void loadRefs(controller.signal); }} aria-label="Обновить ветки и теги" className={`flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-xl border border-line text-muted hover:border-accent/40 disabled:opacity-40 ${FOCUS}`}><ArrowClockwiseIcon size={18} className={loading ? "animate-spin motion-reduce:animate-none" : ""} /></button></div>
        <label className="block text-xs text-muted">База · предыдущая версия<select aria-label="База релиза" value={baseRef} onChange={event => setBaseRef(event.target.value)} disabled={loading || running || !workspace} className={SELECT}>{workspace?.branches.map(branch => <option key={branch.ref} value={branch.ref}>{branch.label} · {branch.sha.slice(0, 7)}</option>)}</select></label>
        <label className="block text-xs text-muted">Релиз · новая версия<select aria-label="Коммит релиза" value={headRef} onChange={event => setHeadRef(event.target.value)} disabled={loading || running || !workspace} className={SELECT}>{workspace?.branches.map(branch => <option key={branch.ref} value={branch.ref}>{branch.label} · {branch.sha.slice(0, 7)}</option>)}</select></label>
        <p className="text-xs leading-relaxed text-muted">База должна быть предком релиза. Ветки и теги берутся из Git на сервере.</p>
        {sameCommit && <p className="text-xs text-amber-200">Выбран один коммит. Укажите предыдущую версию в поле «База».</p>}
        {refsError && <p role="alert" className="break-words text-xs text-red-300">{refsError}</p>}
        {running ? <button key="stop" type="button" onClick={() => abortRef.current?.abort()} className={`flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-red-400/30 px-4 py-2 text-sm text-red-300 ${FOCUS}`}><StopIcon size={16} />Остановить</button>
          : <button key="prepare" type="submit" disabled={loading || !workspace || sameCommit || !!refsError} className={`flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent-deep px-4 py-2 text-sm font-semibold text-white hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS}`}><PlayIcon size={16} weight="fill" />Подготовить релиз</button>}
      </form>
      <section className={`${CARD} space-y-3`} aria-label="Как участвует AI"><h2 className="text-sm font-semibold">От изменений к release notes</h2><ol className="space-y-3 text-xs leading-relaxed text-muted"><li><span className="mr-2 font-mono text-accent">01</span>Git: коммиты и diff выбранного диапазона.</li><li><span className="mr-2 font-mono text-accent">02</span>AI: описание изменений, риски и рекомендации со ссылками на исходники.</li><li><span className="mr-2 font-mono text-accent">03</span>GitHub Actions: фактические результаты для SHA релиза.</li><li><span className="mr-2 font-mono text-accent">04</span>Markdown: просмотр diff и сохранение в проект.</li></ol><p className="border-t border-line pt-3 text-[11px] text-muted">Модель: <span className="font-mono">{RELEASE_CONFIG.model}</span></p></section>
      {ci && <CiStatus ci={ci} />}
    </aside>
    <section className={`${CARD} min-h-[34rem] space-y-4`} aria-label="Результат подготовки релиза">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold">Flash Release</h2><p ref={statusRef} tabIndex={-1} role="status" className="mt-1 text-xs leading-relaxed text-muted">{statusText}</p></div><span className="rounded-full border border-accent/25 bg-accent/10 px-3 py-1 font-mono text-[11px] text-accent">Day 35</span></div>
      {snapshot && <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-xl border border-line bg-background/60 p-3 text-xs"><span className="flex items-center gap-2 font-mono"><GitBranchIcon size={16} className="text-accent" />{snapshot.baseSha.slice(0, 7)}…{snapshot.headSha.slice(0, 7)}</span><span className="text-muted">Diff: {snapshot.files.length}/{snapshot.totalFiles} файлов</span><span className="text-muted">Коммитов: {snapshot.commits.length}{snapshot.commitsTruncated ? "+" : ""}</span></div>}
      {running && <ol aria-label="Ход подготовки" className="space-y-2 rounded-xl border border-accent/20 bg-accent/5 p-3 text-xs text-muted">{progress.map((message, index) => <li key={index} className={index === progress.length - 1 ? "text-foreground" : ""}><span className="mr-2 font-mono text-accent">{String(index + 1).padStart(2, "0")}</span>{message}</li>)}</ol>}
      {error && <p role="alert" className="rounded-xl border border-red-400/25 bg-red-400/5 p-3 text-sm text-red-300">{error}</p>}
      {snapshot && <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3"><button type="button" aria-pressed={view === "notes"} onClick={() => setView("notes")} className={`min-h-11 min-w-11 cursor-pointer rounded-xl px-3 text-xs ${view === "notes" ? "bg-accent/15 text-accent" : "text-muted hover:bg-accent/10"} ${FOCUS}`}>Release notes</button><button type="button" aria-pressed={view === "diff"} onClick={() => setView("diff")} className={`min-h-11 min-w-11 cursor-pointer rounded-xl px-3 text-xs ${view === "diff" ? "bg-accent/15 text-accent" : "text-muted hover:bg-accent/10"} ${FOCUS}`}>Источники и diff</button>{report && <a download={`release-${report.snapshot.headSha.slice(0, 12)}.md`} href={`data:text/markdown;charset=utf-8,${encodeURIComponent(report.markdown)}`} className={`ml-auto inline-flex min-h-11 min-w-11 items-center gap-2 rounded-xl border border-line px-3 text-xs text-muted hover:border-accent/40 ${FOCUS}`}><ArrowDownIcon size={16} />Скачать .md</a>}</div>}
      {view === "diff" && snapshot ? <SourceDiff snapshot={snapshot} /> : report ? <>
        <div className="prose prose-invert max-w-none break-words text-sm [overflow-wrap:anywhere] prose-headings:tracking-tight prose-h1:text-xl prose-h2:text-base prose-a:text-accent prose-pre:overflow-auto prose-pre:bg-background prose-code:text-xs prose-li:my-1"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a> }}>{report.markdown}</ReactMarkdown></div>
        {report.proposal && <FileProposalCard key={report.proposal.id} proposal={report.proposal} disabled={running} />}
        {report.proposalError && <p role="alert" className="rounded-xl border border-amber-300/25 p-3 text-xs text-amber-200">Отчёт готов, но сохранить его в проект пока нельзя: {report.proposalError} Markdown можно скачать.</p>}
      </> : !running && <div className="flex min-h-80 flex-col items-center justify-center gap-4 px-2 text-center"><div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-accent/25 bg-accent/10 text-accent"><GitBranchIcon size={30} /></div><div><h3 className="text-base font-semibold">Подготовьте следующий выпуск</h3><p className="mx-auto mt-2 max-w-[52ch] text-sm leading-relaxed text-muted">Выберите предыдущую и новую версии. AI соберёт release notes из реальных изменений и покажет, что проверить перед выпуском.</p></div><p className="max-w-[55ch] text-xs leading-relaxed text-muted">Отчёт появится здесь. Сохранение файла потребует отдельного нажатия «Применить».</p></div>}
    </section>
  </div>;
}

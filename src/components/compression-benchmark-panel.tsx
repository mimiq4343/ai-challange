"use client";

import { useEffect, useRef, useState } from "react";
import { FlaskIcon, XIcon } from "@phosphor-icons/react";
import type {
  BenchmarkVariant,
  CompressionRun,
  JudgeScores,
} from "@/lib/compression-types";

type Props = { initialRun: CompressionRun | null };

function formatTokens(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatCost(value: number): string {
  return `$${(value / 1_000_000).toFixed(6)}`;
}

export function CompressionBenchmarkPanel({ initialRun }: Props) {
  const [run, setRun] = useState(initialRun);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function closeDialog() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  async function runBenchmark() {
    closeDialog();
    setRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/compression-experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload || typeof payload !== "object" || !("run" in payload)) {
        throw new Error(
          payload && typeof payload === "object" && "error" in payload
            ? String(payload.error)
            : `Сервер вернул ${response.status}.`,
        );
      }
      setRun(payload.run as CompressionRun);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Benchmark завершился ошибкой.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="border-t border-line px-4 py-4" aria-labelledby="benchmark-title">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">Blind judge</p>
          <h2 id="benchmark-title" className="mt-1 text-base font-semibold">Full vs compressed</h2>
        </div>
        <button
          ref={triggerRef}
          type="button"
          disabled={running}
          onClick={() => setOpen(true)}
          className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-accent-deep px-3 text-xs font-semibold text-white hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
        >
          <FlaskIcon size={16} aria-hidden />
          {running ? "4 вызова…" : "Запустить"}
        </button>
      </div>

      {error && <p className="mt-3 rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200" role="alert">{error}</p>}
      {run ? <RunResult run={run} /> : <p className="mt-3 rounded-xl border border-dashed border-line px-3 py-5 text-center text-xs text-muted">Подтвердите один benchmark: summary, два ответа и слепой judge.</p>}

      <dialog
        ref={dialogRef}
        aria-labelledby="benchmark-dialog-title"
        onCancel={(event) => { event.preventDefault(); closeDialog(); }}
        onClose={() => setOpen(false)}
        className="m-auto w-[min(92vw,30rem)] rounded-2xl border border-line bg-surface p-0 text-foreground shadow-[0_24px_100px_rgba(0,0,0,0.7)] backdrop:bg-black/70"
      >
        <div className="p-5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 id="benchmark-dialog-title" className="font-semibold">Запустить 4 LLM-вызова?</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">Последовательно: summary, full answer, compressed answer и blind judge. Retry отсутствует.</p>
            </div>
            <button type="button" onClick={closeDialog} aria-label="Закрыть подтверждение" className="flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-accent"><XIcon size={18} aria-hidden /></button>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={closeDialog} className="min-h-11 rounded-xl border border-line px-4 text-sm focus-visible:outline-2 focus-visible:outline-accent">Отмена</button>
            <button type="button" onClick={() => void runBenchmark()} className="min-h-11 rounded-xl bg-accent-deep px-4 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-accent">Запустить</button>
          </div>
        </div>
      </dialog>
    </section>
  );
}

function RunResult({ run }: { run: CompressionRun }) {
  const fullScores = run.labelA === "full" ? run.judge.a : run.judge.b;
  const compressedScores = run.labelA === "compressed" ? run.judge.a : run.judge.b;
  const winner: BenchmarkVariant | "tie" = run.judge.winner === "tie"
    ? "tie"
    : run.judge.winner === "a"
      ? run.labelA
      : run.labelA === "full" ? "compressed" : "full";
  return (
    <div className="mt-4 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Answer title="Full" text={run.fullAnswer} scores={fullScores} winner={winner === "full"} />
        <Answer title="Compressed" text={run.compressedAnswer} scores={compressedScores} winner={winner === "compressed"} />
      </div>
      <div className="rounded-xl border border-line p-3 text-xs">
        <p className="font-medium">Judge: {winner === "tie" ? "ничья" : winner}</p>
        <p className="mt-1 break-words leading-relaxed text-muted">{run.judge.rationale}</p>
      </div>
      <div className="grid grid-cols-3 gap-2 font-mono text-[10px]">
        <Metric label="Gross" value={run.grossSavedTokens} />
        <Metric label="Summary overhead" value={run.summaryOverheadTokens} />
        <Metric label="Net" value={run.netSavedTokens} />
      </div>
      <div className="rounded-xl border border-line p-3 font-mono text-[10px] text-muted">
        <p>Full {formatTokens(run.calls.full.promptTokens)} · {formatCost(run.calls.full.costMicrosUsd)}</p>
        <p className="mt-1">Compressed {formatTokens(run.calls.compressed.promptTokens)} · {formatCost(run.calls.compressed.costMicrosUsd)}</p>
        <p className="mt-1">Summary {formatTokens(run.calls.summary.totalTokens)} · {formatCost(run.calls.summary.costMicrosUsd)}</p>
        <p className="mt-1 border-t border-line pt-1">Judge overhead {formatTokens(run.calls.judge.totalTokens)} · {formatCost(run.calls.judge.costMicrosUsd)} · не входит в net</p>
      </div>
    </div>
  );
}

function Answer({ title, text, scores, winner }: { title: string; text: string; scores: JudgeScores; winner: boolean }) {
  return <article className={`min-w-0 rounded-xl border p-3 ${winner ? "border-accent/50 bg-accent/5" : "border-line"}`}><p className="text-xs font-semibold">{title}{winner ? " · winner" : ""}</p><pre className="mt-2 whitespace-pre-wrap break-all font-sans text-[10px] leading-relaxed text-muted">{text}</pre><p className="mt-2 font-mono text-[9px] text-muted">F {scores.factualAccuracy} · C {scores.completeness} · I {scores.instructionFollowing} · Σ {scores.overall}</p></article>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border border-line p-2"><p className="text-accent">{value >= 0 ? "+" : ""}{formatTokens(value)}</p><p className="mt-1 text-muted">{label}</p></div>;
}

"use client";

import type { ContextBenchmarkRun } from "@/lib/context-strategy-types";

const LABELS = {
  sliding: "Sliding",
  facts: "Sticky Facts",
  branching: "Branching",
} as const;

type Props = {
  run: ContextBenchmarkRun | null;
  running: boolean;
  error: string | null;
  onRun: () => void;
};

export function ContextBenchmarkPanel({ run, running, error, onRun }: Props) {
  return (
    <section className="p-4" aria-label="Сравнение стратегий">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
            Same scenario
          </p>
          <h2 className="mt-1 font-semibold">Сравнение стратегий</h2>
        </div>
        <button
          type="button"
          disabled={running}
          onClick={onRun}
          className="min-h-11 rounded-xl bg-accent-deep px-4 text-xs font-medium text-white disabled:opacity-45"
        >
          {running ? "Запуск…" : "Запустить"}
        </button>
      </div>

      {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
      {!run ? (
        <p className="mt-4 text-xs leading-relaxed text-muted">
          Один сценарий ТЗ, одинаковый финальный вопрос, provider usage и проверка 8 обязательных деталей.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {run.results.map((result) => (
            <article key={result.strategy} className="rounded-xl border border-line bg-background/60 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">{LABELS[result.strategy]}</p>
                <span className="font-mono text-xs text-accent">
                  Q {result.qualityScore}/10 · S {result.stabilityScore}/10
                </span>
              </div>
              <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted">
                {result.answer}
              </p>
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-muted">
                <span>prompt {result.promptTokens}</span>
                <span>output {result.completionTokens}</span>
                <span>overhead {result.overheadTokens}</span>
                <span>${(result.costMicrosUsd / 1_000_000).toFixed(6)}</span>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted">
                {result.usability}
              </p>
              {result.missingFacts.length > 0 && (
                <p className="mt-2 text-[10px] text-amber-200">
                  Потеряно: {result.missingFacts.join(" · ")}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

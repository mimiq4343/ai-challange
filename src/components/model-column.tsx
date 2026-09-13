"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckCircle, Question, XCircle } from "@phosphor-icons/react";
import {
  DAY5_PROVIDERS,
  countWords,
  formatMs,
  formatUsd,
  type JudgeScore,
  type ModelSpec,
  type RunMetrics,
  type Verdict,
} from "@/lib/day5";

export type ModelRun = {
  text: string;
  status: "idle" | "running" | "done" | "error";
  error: string | null;
  metrics: RunMetrics | null;
  answer: string | null;
  verdict: Verdict | null;
  score: JudgeScore | null;
  /** Анонимная метка, под которой ответ ушёл судье. */
  judgeLabel: string | null;
};

export const IDLE_RUN: ModelRun = {
  text: "",
  status: "idle",
  error: null,
  metrics: null,
  answer: null,
  verdict: null,
  score: null,
  judgeLabel: null,
};

const VERDICTS: Record<Verdict, { label: string; className: string; Icon: typeof CheckCircle }> = {
  correct: { label: "верно", className: "bg-emerald-400/10 text-emerald-300", Icon: CheckCircle },
  wrong: { label: "неверно", className: "bg-red-400/10 text-red-300", Icon: XCircle },
  missing: { label: "нет строки ОТВЕТ", className: "bg-amber-400/10 text-amber-300", Icon: Question },
};

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const { label, className, Icon } = VERDICTS[verdict];
  return (
    <span className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${className}`}>
      <Icon size={13} weight="fill" /> {label}
    </span>
  );
}

function Metric({ term, value, hint }: { term: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted">{term}</dt>
      <dd className="text-right text-foreground">
        {value}
        {hint && <span className="ml-1 text-muted">{hint}</span>}
      </dd>
    </div>
  );
}

export function ModelColumn({
  spec,
  run,
  highlight,
}: {
  spec: ModelSpec;
  run: ModelRun;
  highlight: { fastest: boolean; cheapest: boolean; bestJudged: boolean };
}) {
  const metrics = run.metrics;
  const provider = DAY5_PROVIDERS[spec.provider];
  const badges = [
    highlight.fastest && "быстрее всех",
    highlight.cheapest && "дешевле всех",
    highlight.bestJudged && "выбор судьи",
  ].filter(Boolean) as string[];

  return (
    <section className="flex min-h-[420px] flex-col overflow-hidden rounded-2xl border border-line bg-surface">
      <header className="border-b border-line px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="rounded-full border border-accent/25 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
            {spec.tierLabel}
          </span>
          {run.verdict && <VerdictBadge verdict={run.verdict} />}
        </div>
        <h2 className="mt-2 font-mono text-sm font-semibold break-all">{spec.model}</h2>
        <p className="text-[11px] text-muted">{provider.label}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted">{spec.tagline}</p>

        {badges.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {badges.map((badge) => (
              <span
                key={badge}
                className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-300"
              >
                {badge}
              </span>
            ))}
          </div>
        )}

        {metrics && (
          <dl className="mt-3 grid gap-1 font-mono text-[10px]">
            <Metric term="первый токен" value={formatMs(metrics.ttftMs)} />
            <Metric term="весь ответ" value={formatMs(metrics.totalMs)} />
            <Metric
              term="скорость"
              value={metrics.tokensPerSec === null ? "—" : `${Math.round(metrics.tokensPerSec)} ток/с`}
            />
            <Metric
              term="токены"
              value={`${metrics.usage.promptTokens} + ${metrics.usage.completionTokens}`}
              hint={
                metrics.usage.reasoningTokens > 0 ? `(из них ${metrics.usage.reasoningTokens} на мысли)` : undefined
              }
            />
            <Metric term="стоимость" value={formatUsd(metrics.costUsd)} hint={`· ${metrics.rateNote}`} />
            <Metric term="1000 запросов" value={formatUsd(metrics.costUsd * 1000)} />
            {run.text.length > 0 && <Metric term="слов в ответе" value={String(countWords(run.text))} />}
          </dl>
        )}
      </header>

      <div className="chat-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3">
        {run.status === "idle" && <p className="text-xs text-muted">Ответ появится здесь.</p>}
        {run.error && <p className="text-xs text-red-300">{run.error}</p>}
        <div className="chat-md text-sm leading-relaxed">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{run.text}</ReactMarkdown>
        </div>
        {run.status === "running" && (
          <span className="ml-0.5 inline-block h-3.5 w-1.5 rounded-[2px] bg-accent motion-safe:animate-pulse" />
        )}
      </div>

      {run.score && (
        <footer className="border-t border-line px-4 py-2 font-mono text-[10px] text-muted">
          судья{run.judgeLabel && ` (ответ ${run.judgeLabel})`}: верность {run.score.correctness}/5 · польза{" "}
          {run.score.usefulness}/5
          {run.score.flaw && <span className="text-amber-300"> · {run.score.flaw}</span>}
        </footer>
      )}
    </section>
  );
}

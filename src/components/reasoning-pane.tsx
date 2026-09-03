"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckCircle, Question, XCircle } from "@phosphor-icons/react";
import type { StrategyMeta, Verdict } from "@/lib/day3";
import type { PhaseSpec } from "@/lib/day3-runner";

export type Phase = PhaseSpec & { text: string };

export type PaneState = {
  status: "idle" | "running" | "done" | "error";
  phases: Phase[];
  error: string | null;
  /** Длительность способа целиком, вместе со всеми его запросами. */
  ms: number | null;
  chars: number;
  answer: string | null;
  verdict: Verdict | null;
};

export const IDLE_PANE: PaneState = {
  status: "idle",
  phases: [],
  error: null,
  ms: null,
  chars: 0,
  answer: null,
  verdict: null,
};

const VERDICTS: Record<
  Verdict,
  { label: string; className: string; Icon: typeof CheckCircle }
> = {
  correct: {
    label: "совпал с эталоном",
    className: "bg-emerald-400/10 text-emerald-300",
    Icon: CheckCircle,
  },
  wrong: {
    label: "не совпал",
    className: "bg-red-400/10 text-red-300",
    Icon: XCircle,
  },
  missing: {
    label: "строки ОТВЕТ нет",
    className: "bg-amber-400/10 text-amber-300",
    Icon: Question,
  },
};

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const { label, className, Icon } = VERDICTS[verdict];
  return (
    <span
      className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs ${className}`}
    >
      <Icon size={14} weight="fill" /> {label}
    </span>
  );
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)} с`;
}

export function ReasoningPane({ meta, state }: { meta: StrategyMeta; state: PaneState }) {
  const multiphase = state.phases.length > 1;

  return (
    <section className="flex min-h-[340px] flex-col overflow-hidden rounded-2xl border border-line bg-surface">
      <header className="border-b border-line px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-sm font-semibold">{meta.name}</h2>
          {state.verdict && <VerdictBadge verdict={state.verdict} />}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted">{meta.tagline}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {meta.chips.map((chip) => (
            <span
              key={chip}
              className="rounded-md border border-accent/20 bg-accent/5 px-1.5 py-0.5 font-mono text-[10px] text-accent"
            >
              {chip}
            </span>
          ))}
          <span className="ml-auto font-mono text-[10px] text-muted">
            {state.ms === null ? "—" : formatDuration(state.ms)} · {state.chars} симв.
          </span>
        </div>
      </header>

      <div className="chat-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {state.status === "idle" && <p className="text-sm text-muted">Ответ появится здесь.</p>}
        {state.error && <p className="text-sm text-red-300">{state.error}</p>}
        {state.phases.map((phase, index) => (
          <div key={phase.label}>
            {multiphase && (
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                {phase.label}
              </p>
            )}
            {phase.mono ? (
              <pre className="whitespace-pre-wrap break-words rounded-xl border border-line bg-background px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground/90">
                {phase.text}
              </pre>
            ) : (
              <div className="chat-md text-sm leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{phase.text}</ReactMarkdown>
              </div>
            )}
            {state.status === "running" && phase.text.length > 0 && index === state.phases.length - 1 && (
              <span className="ml-0.5 inline-block h-4 w-2 rounded-[2px] bg-accent motion-safe:animate-pulse" />
            )}
          </div>
        ))}
      </div>

      {state.answer !== null && (
        <footer className="border-t border-line px-4 py-2 text-xs">
          <span className="text-muted">Финальный ответ: </span>
          <span className="font-mono text-foreground">{state.answer}</span>
        </footer>
      )}
    </section>
  );
}

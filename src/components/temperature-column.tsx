"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckCircle, Question, XCircle } from "@phosphor-icons/react";
import type { DiversityStats, JudgeScore, TemperatureSetting, Verdict } from "@/lib/day4";

export type SampleState = {
  text: string;
  status: "idle" | "running" | "done" | "error";
  error: string | null;
  ms: number | null;
  answer: string | null;
  verdict: Verdict | null;
  score: JudgeScore | null;
};

export const IDLE_SAMPLE: SampleState = {
  text: "",
  status: "idle",
  error: null,
  ms: null,
  answer: null,
  verdict: null,
  score: null,
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

const percent = (value: number) => `${Math.round(value * 100)}%`;

export function TemperatureColumn({
  setting,
  samples,
  stats,
  hasReference,
}: {
  setting: TemperatureSetting;
  samples: SampleState[];
  stats: DiversityStats | null;
  hasReference: boolean;
}) {
  const finished = samples.filter((s) => s.status === "done");
  const correct = finished.filter((s) => s.verdict === "correct").length;
  const scored = finished.filter((s) => s.score !== null);
  const avg = (pick: (score: JudgeScore) => number) =>
    scored.length === 0
      ? null
      : (scored.reduce((sum, s) => sum + pick(s.score!), 0) / scored.length).toFixed(1);

  return (
    <section className="flex min-h-[360px] flex-col overflow-hidden rounded-2xl border border-line bg-surface">
      <header className="border-b border-line px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-mono text-sm font-semibold text-accent">temperature {setting.label}</h2>
          {hasReference && finished.length > 0 && (
            <span className="text-[11px] text-muted">
              точность {correct} из {finished.length}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted">{setting.tagline}</p>
        {stats && stats.total > 0 && (
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-muted">
            <div className="flex justify-between gap-2">
              <dt>уникальных</dt>
              <dd className="text-foreground">
                {stats.unique} из {stats.total}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>разнообразие</dt>
              <dd className="text-foreground">{percent(stats.distinct)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>лексика</dt>
              <dd className="text-foreground">{percent(stats.lexicalRichness)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>слов в ответе</dt>
              <dd className="text-foreground">{Math.round(stats.avgWords)}</dd>
            </div>
            {avg((s) => s.creativity) && (
              <div className="flex justify-between gap-2">
                <dt>креативность</dt>
                <dd className="text-foreground">{avg((s) => s.creativity)} из 5</dd>
              </div>
            )}
            {avg((s) => s.coherence) && (
              <div className="flex justify-between gap-2">
                <dt>связность</dt>
                <dd className="text-foreground">{avg((s) => s.coherence)} из 5</dd>
              </div>
            )}
          </dl>
        )}
      </header>

      <div className="chat-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        {samples.map((sample, index) => (
          <article key={index} className="rounded-xl border border-line bg-background px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wide text-muted">
                ответ {index + 1}
                {sample.ms !== null && ` · ${(sample.ms / 1000).toFixed(1)} с`}
              </span>
              {sample.verdict && <VerdictBadge verdict={sample.verdict} />}
            </div>
            {sample.status === "idle" && (
              <p className="mt-1 text-xs text-muted">Ответ появится здесь.</p>
            )}
            {sample.error && <p className="mt-1 text-xs text-red-300">{sample.error}</p>}
            <div className="chat-md mt-1 text-sm leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{sample.text}</ReactMarkdown>
            </div>
            {sample.status === "running" && (
              <span className="ml-0.5 inline-block h-3.5 w-1.5 rounded-[2px] bg-accent motion-safe:animate-pulse" />
            )}
            {sample.score && (
              <p className="mt-2 border-t border-line pt-1.5 font-mono text-[10px] text-muted">
                креатив {sample.score.creativity}/5 · связность {sample.score.coherence}/5
                {sample.score.flaw && (
                  <span className="text-amber-300"> · {sample.score.flaw}</span>
                )}
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

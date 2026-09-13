"use client";

import { DAY5_MODELS, formatMs, formatUsd, type RunMetrics } from "@/lib/day5";
import type { ModelRun } from "./model-column";

type Row = {
  label: string;
  model: string;
  run: ModelRun;
  metrics: RunMetrics;
};

function ratio(worse: number, better: number): string {
  if (better <= 0) return "—";
  const times = worse / better;
  return times >= 10 ? `в ${Math.round(times)} раза` : `в ${times.toFixed(1)} раза`;
}

const LINKS = [
  { label: "DeepSeek · модели и цены", href: "https://api-docs.deepseek.com/quick_start/pricing" },
  { label: "Groq · каталог моделей", href: "https://console.groq.com/docs/models" },
  { label: "Groq · цены", href: "https://groq.com/pricing" },
  { label: "gpt-oss-120b · карточка модели", href: "https://huggingface.co/openai/gpt-oss-120b" },
];

export function Day5Summary({
  runs,
  hasReference,
  judgeVerdict,
}: {
  runs: ModelRun[];
  hasReference: boolean;
  judgeVerdict: string;
}) {
  const rows: Row[] = DAY5_MODELS.map((spec, index) => ({
    label: spec.tierLabel,
    model: spec.model,
    run: runs[index],
    metrics: runs[index].metrics as RunMetrics,
  })).filter((row) => row.metrics);

  if (rows.length === 0) return null;

  const fastest = rows.reduce((best, row) => (row.metrics.totalMs < best.metrics.totalMs ? row : best));
  const slowest = rows.reduce((worst, row) => (row.metrics.totalMs > worst.metrics.totalMs ? row : worst));
  const cheapest = rows.reduce((best, row) => (row.metrics.costUsd < best.metrics.costUsd ? row : best));
  const priciest = rows.reduce((worst, row) => (row.metrics.costUsd > worst.metrics.costUsd ? row : worst));
  const scored = rows.filter((row) => row.run.score !== null);
  const bestJudged =
    scored.length === 0
      ? null
      : scored.reduce((best, row) =>
          row.run.score!.correctness + row.run.score!.usefulness >
          best.run.score!.correctness + best.run.score!.usefulness
            ? row
            : best,
        );
  const correct = rows.filter((row) => row.run.verdict === "correct");

  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="text-sm font-semibold">Сводка прогона</h2>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-left text-xs">
          <thead className="text-muted">
            <tr className="border-b border-line">
              <th className="py-2 pr-3 font-medium">Класс</th>
              <th className="py-2 pr-3 font-medium">Модель</th>
              <th className="py-2 pr-3 font-medium">Первый токен</th>
              <th className="py-2 pr-3 font-medium">Весь ответ</th>
              <th className="py-2 pr-3 font-medium">Скорость</th>
              <th className="py-2 pr-3 font-medium">Токены вход/выход</th>
              <th className="py-2 pr-3 font-medium">Стоимость</th>
              <th className="py-2 pr-3 font-medium">1000 запросов</th>
              {hasReference && <th className="py-2 pr-3 font-medium">Эталон</th>}
              <th className="py-2 font-medium">Судья</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map((row) => (
              <tr key={row.model} className="border-b border-line/60 last:border-0">
                <td className="py-2 pr-3 font-sans text-muted">{row.label}</td>
                <td className="py-2 pr-3">{row.model}</td>
                <td className="py-2 pr-3">{formatMs(row.metrics.ttftMs)}</td>
                <td className="py-2 pr-3">{formatMs(row.metrics.totalMs)}</td>
                <td className="py-2 pr-3">
                  {row.metrics.tokensPerSec === null ? "—" : `${Math.round(row.metrics.tokensPerSec)} ток/с`}
                </td>
                <td className="py-2 pr-3">
                  {row.metrics.usage.promptTokens} / {row.metrics.usage.completionTokens}
                  {row.metrics.usage.reasoningTokens > 0 && (
                    <span className="text-muted"> (+{row.metrics.usage.reasoningTokens} мысли)</span>
                  )}
                </td>
                <td className="py-2 pr-3">{formatUsd(row.metrics.costUsd)}</td>
                <td className="py-2 pr-3">{formatUsd(row.metrics.costUsd * 1000)}</td>
                {hasReference && (
                  <td className="py-2 pr-3">
                    {row.run.verdict === "correct" ? "верно" : row.run.verdict === "wrong" ? "неверно" : "—"}
                  </td>
                )}
                <td className="py-2">
                  {row.run.score
                    ? `${row.run.score.correctness}/5 · ${row.run.score.usefulness}/5`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-3 text-sm leading-relaxed md:grid-cols-3">
        <p className="rounded-xl border border-line bg-background p-3">
          <span className="font-semibold">Скорость.</span> Быстрее всех{" "}
          <span className="font-mono text-accent">{fastest.model}</span>: {formatMs(fastest.metrics.totalMs)}{" "}
          против {formatMs(slowest.metrics.totalMs)} у самой медленной, {ratio(slowest.metrics.totalMs, fastest.metrics.totalMs)} быстрее.
        </p>
        <p className="rounded-xl border border-line bg-background p-3">
          <span className="font-semibold">Цена.</span> Дешевле всех{" "}
          <span className="font-mono text-accent">{cheapest.model}</span>: {formatUsd(cheapest.metrics.costUsd)}{" "}
          против {formatUsd(priciest.metrics.costUsd)}, {ratio(priciest.metrics.costUsd, cheapest.metrics.costUsd)} дешевле.
        </p>
        <p className="rounded-xl border border-line bg-background p-3">
          <span className="font-semibold">Качество.</span>{" "}
          {hasReference && (
            <>
              Эталон угадали {correct.length} из {rows.length}.{" "}
            </>
          )}
          {bestJudged ? (
            <>
              Судья выше всех оценил <span className="font-mono text-accent">{bestJudged.model}</span>.
            </>
          ) : (
            "Оценка судьи не получена."
          )}
        </p>
      </div>

      {judgeVerdict && (
        <p className="mt-3 rounded-xl border border-accent/20 bg-accent/5 p-3 text-sm leading-relaxed">
          <span className="font-semibold">Слепой судья:</span> {judgeVerdict}
        </p>
      )}

      <p className="mt-3 text-xs leading-relaxed text-muted">
        Время меряется на сервере: первый токен — задержка до начала ответа, весь ответ — до последнего
        токена. Стоимость считается по usage самого провайдера и его тарифу на момент запроса; у DeepSeek
        тариф вдвое выше в часы пика (01:00–04:00 и 06:00–10:00 UTC по будням).
      </p>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noreferrer"
            className="text-accent underline-offset-2 hover:underline"
          >
            {link.label}
          </a>
        ))}
      </div>
    </section>
  );
}

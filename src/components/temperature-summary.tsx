"use client";

import { DAY4_TEMPERATURES, type DiversityStats, type JudgeScore } from "@/lib/day4";
import type { SampleState } from "./temperature-column";

const percent = (value: number) => `${Math.round(value * 100)}%`;

const RECOMMENDATIONS = [
  {
    label: "temperature 0",
    when: "Извлечение данных, классификация, код, расчёты, парсинг, автотесты и всё, что должно повторяться от прогона к прогону.",
    watch: "Ответ один и тот же, поэтому переформулировать неудачную фразу бесполезно — нужно менять промпт.",
  },
  {
    label: "temperature 0.7",
    when: "Рабочий диапазон для текста: письма, описания, объяснения, ответы в чате, черновики документации.",
    watch: "Формулировки гуляют, факты обычно держатся; для проверяемых задач всё равно нужна сверка.",
  },
  {
    label: "temperature 1.2",
    when: "Брейншторм: слоганы, названия, метафоры, варианты заголовков — когда нужен пул идей и человек отбирает лучшее.",
    watch: "Растёт доля неудачных и попросту неверных ответов, поэтому в фактических задачах эта настройка вредна.",
  },
];

export function TemperatureSummary({
  samplesByTemperature,
  stats,
  hasReference,
}: {
  samplesByTemperature: SampleState[][];
  stats: (DiversityStats | null)[];
  hasReference: boolean;
}) {
  const avg = (samples: SampleState[], pick: (score: JudgeScore) => number) => {
    const scored = samples.filter((s) => s.score !== null);
    if (scored.length === 0) return null;
    return scored.reduce((sum, s) => sum + pick(s.score!), 0) / scored.length;
  };

  const rows = DAY4_TEMPERATURES.map((setting, index) => {
    const samples = samplesByTemperature[index];
    const done = samples.filter((s) => s.status === "done");
    return {
      setting,
      stats: stats[index],
      correct: done.filter((s) => s.verdict === "correct").length,
      done: done.length,
      creativity: avg(samples, (s) => s.creativity),
      coherence: avg(samples, (s) => s.coherence),
    };
  });

  const mostDiverse = rows.reduce((best, row) =>
    (row.stats?.distinct ?? -1) > (best.stats?.distinct ?? -1) ? row : best,
  );
  const mostCreative = rows.reduce((best, row) =>
    (row.creativity ?? -1) > (best.creativity ?? -1) ? row : best,
  );

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
      <h2 className="text-sm font-semibold">Сравнение температур</h2>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="border-b border-line py-2 pr-3 font-medium">Температура</th>
              {hasReference && (
                <th className="border-b border-line py-2 pr-3 font-medium">Точность</th>
              )}
              <th className="border-b border-line py-2 pr-3 font-medium">Уникальных</th>
              <th className="border-b border-line py-2 pr-3 font-medium">Разнообразие</th>
              <th className="border-b border-line py-2 pr-3 font-medium">Лексика</th>
              <th className="border-b border-line py-2 pr-3 font-medium">Креативность</th>
              <th className="border-b border-line py-2 font-medium">Связность</th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {rows.map((row) => (
              <tr key={row.setting.value}>
                <td className="border-b border-line py-2 pr-3 text-foreground">
                  {row.setting.label}
                </td>
                {hasReference && (
                  <td className="border-b border-line py-2 pr-3">
                    {row.done === 0 ? "—" : `${row.correct} из ${row.done}`}
                  </td>
                )}
                <td className="border-b border-line py-2 pr-3">
                  {row.stats ? `${row.stats.unique} из ${row.stats.total}` : "—"}
                </td>
                <td className="border-b border-line py-2 pr-3">
                  {row.stats ? percent(row.stats.distinct) : "—"}
                </td>
                <td className="border-b border-line py-2 pr-3">
                  {row.stats ? percent(row.stats.lexicalRichness) : "—"}
                </td>
                <td className="border-b border-line py-2 pr-3">
                  {row.creativity === null ? "—" : `${row.creativity.toFixed(1)} из 5`}
                </td>
                <td className="border-b border-line py-2">
                  {row.coherence === null ? "—" : `${row.coherence.toFixed(1)} из 5`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-sm leading-relaxed text-muted">
        В этом прогоне разнообразнее всех оказалась температура{" "}
        <span className="font-mono text-foreground">{mostDiverse.setting.label}</span>
        {mostDiverse.stats && <> ({percent(mostDiverse.stats.distinct)} различий между ответами)</>}
        {mostCreative.creativity !== null && (
          <>
            , а выше всего судья оценил креативность при температуре{" "}
            <span className="font-mono text-foreground">{mostCreative.setting.label}</span> (
            {mostCreative.creativity.toFixed(1)} из 5)
          </>
        )}
        .
      </p>

      <div className="grid gap-3 lg:grid-cols-3">
        {RECOMMENDATIONS.map((item) => (
          <article key={item.label} className="rounded-xl border border-line bg-background p-3">
            <h3 className="font-mono text-xs font-semibold text-accent">{item.label}</h3>
            <p className="mt-1.5 text-sm leading-relaxed">{item.when}</p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">{item.watch}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

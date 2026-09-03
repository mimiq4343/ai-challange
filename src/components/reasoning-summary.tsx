"use client";

import { DAY3_STRATEGIES, type StrategyId } from "@/lib/day3";
import { VerdictBadge, type PaneState } from "./reasoning-pane";

function fastest(panes: Record<StrategyId, PaneState>): string | null {
  const finished = DAY3_STRATEGIES.filter((s) => panes[s.id].ms !== null);
  if (finished.length === 0) return null;
  return finished.reduce((best, s) => (panes[s.id].ms! < panes[best.id].ms! ? s : best)).name;
}

function wordiest(panes: Record<StrategyId, PaneState>): string | null {
  const withText = DAY3_STRATEGIES.filter((s) => panes[s.id].chars > 0);
  if (withText.length === 0) return null;
  return withText.reduce((max, s) => (panes[s.id].chars > panes[max.id].chars ? s : max)).name;
}

export function ReasoningSummary({
  panes,
  expected,
}: {
  panes: Record<StrategyId, PaneState>;
  expected: string;
}) {
  const correct = DAY3_STRATEGIES.filter((s) => panes[s.id].verdict === "correct");
  const quickest = fastest(panes);
  const longest = wordiest(panes);

  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Сравнение способов</h2>
        <p className="text-xs text-muted">
          Эталон: <span className="font-mono text-foreground">{expected}</span>
        </p>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="border-b border-line py-2 pr-3 font-medium">Способ</th>
              <th className="border-b border-line py-2 pr-3 font-medium">Ответ</th>
              <th className="border-b border-line py-2 pr-3 font-medium">Проверка</th>
              <th className="border-b border-line py-2 pr-3 font-medium">Время</th>
              <th className="border-b border-line py-2 pr-3 font-medium">Символов</th>
              <th className="border-b border-line py-2 font-medium">Запросов</th>
            </tr>
          </thead>
          <tbody>
            {DAY3_STRATEGIES.map((strategy) => {
              const pane = panes[strategy.id];
              return (
                <tr key={strategy.id} className="align-middle">
                  <td className="border-b border-line py-2 pr-3">{strategy.name}</td>
                  <td className="border-b border-line py-2 pr-3 font-mono text-xs">
                    {pane.answer ?? (pane.error ? "ошибка" : "—")}
                  </td>
                  <td className="border-b border-line py-2 pr-3">
                    {pane.verdict ? <VerdictBadge verdict={pane.verdict} /> : "—"}
                  </td>
                  <td className="border-b border-line py-2 pr-3 font-mono text-xs">
                    {pane.ms === null ? "—" : `${(pane.ms / 1000).toFixed(1)} с`}
                  </td>
                  <td className="border-b border-line py-2 pr-3 font-mono text-xs">{pane.chars}</td>
                  <td className="border-b border-line py-2 font-mono text-xs">{strategy.calls}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-muted">
        Совпали с эталоном: {correct.length} из {DAY3_STRATEGIES.length}
        {correct.length > 0 && <> — {correct.map((s) => s.name).join(", ")}</>}.
        {quickest && <> Быстрее всех: {quickest}.</>}
        {longest && <> Многословнее всех: {longest}.</>}
      </p>
    </section>
  );
}

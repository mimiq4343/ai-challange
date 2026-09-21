"use client";

import type { MemoryLayerTokens } from "@/lib/memory-types";

export type MemoryTelemetrySource = "preview" | "stored";

type MemoryTelemetryBarProps = {
  tokens: MemoryLayerTokens | null;
  source: MemoryTelemetrySource | null;
  shortTermMessages: number | null;
  windowMessages: number;
  routerCostMicrosUsd: number | null;
  totalCostMicrosUsd: number;
  updating: boolean;
};

const numberFormat = new Intl.NumberFormat("ru-RU");

export function MemoryTelemetryBar({
  tokens,
  source,
  shortTermMessages,
  windowMessages,
  routerCostMicrosUsd,
  totalCostMicrosUsd,
  updating,
}: MemoryTelemetryBarProps) {
  if (!tokens) {
    return (
      <p className="font-mono text-[10px] leading-relaxed text-muted">
        Телеметрия появится после первого обмена · окно STM {windowMessages} сообщений
      </p>
    );
  }

  const segments = [
    { label: "sys", value: tokens.systemTokens, className: "bg-white/35" },
    { label: "INV", value: tokens.invariantTokens, className: "bg-rose-400" },
    { label: "PROF", value: tokens.profileTokens, className: "bg-sky-400" },
    { label: "TASK", value: tokens.taskTokens, className: "bg-amber-300" },
    { label: "LTM", value: tokens.longTermTokens, className: "bg-emerald-400" },
    { label: "WM", value: tokens.workingTokens, className: "bg-amber-400" },
    { label: "STM", value: tokens.shortTermTokens, className: "bg-accent" },
    { label: "req", value: tokens.requestTokens, className: "bg-violet-400" },
  ];
  const total = Math.max(tokens.promptTokens, 1);
  const contextPercent = (tokens.contextTokens / tokens.contextLimit) * 100;

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="flex h-1.5 overflow-hidden rounded-full bg-white/5"
        role="img"
        aria-label={`Вклад слоёв в промпт: ${segments
          .map((segment) => `${segment.label} ${numberFormat.format(segment.value)}`)
          .join(", ")}`}
      >
        {segments.map((segment) => (
          <span
            key={segment.label}
            className={segment.className}
            style={{ width: `${(segment.value / total) * 100}%` }}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-muted">
        {segments.map((segment) => (
          <span key={segment.label} className="inline-flex items-center gap-1">
            <span className={`h-1.5 w-1.5 rounded-full ${segment.className}`} aria-hidden />
            {segment.label} {numberFormat.format(segment.value)}
          </span>
        ))}
        <span className="text-foreground">Σ {numberFormat.format(tokens.promptTokens)}</span>
        <span>{contextPercent.toFixed(3)}% окна</span>
        {shortTermMessages !== null && (
          <span>
            STM {shortTermMessages}/{windowMessages} сообщ.
          </span>
        )}
        <span>${(totalCostMicrosUsd / 1_000_000).toFixed(6)} всего</span>
        {routerCostMicrosUsd !== null && (
          <span>роутер ${(routerCostMicrosUsd / 1_000_000).toFixed(6)}</span>
        )}
        <span className="ml-auto">
          {updating ? "обновление памяти…" : source === "preview" ? "оценка" : "provider"}
        </span>
      </div>
    </div>
  );
}

import { ChartBarIcon, CoinsIcon, GaugeIcon } from "@phosphor-icons/react";

import type {
  ConversationUsageAnalytics,
  TokenBreakdown,
} from "@/lib/conversation-types";

type TokenAnalyticsPanelProps = {
  analytics: ConversationUsageAnalytics | null;
  preview: TokenBreakdown | null;
  loading: boolean;
  error: string | null;
};

function formatTokens(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatCost(value: number): string {
  return `$${(value / 1_000_000).toFixed(6)}`;
}

export function TokenAnalyticsPanel({
  analytics,
  preview,
  loading,
  error,
}: TokenAnalyticsPanelProps) {
  const latest = analytics?.exchanges.at(-1) ?? null;
  const promptTokens =
    preview?.promptTokens ?? latest?.providerPromptTokens ?? latest?.promptTokens ?? 0;
  const historyTokens = preview?.historyTokens ?? latest?.historyTokens ?? 0;
  const requestTokens = preview?.requestTokens ?? latest?.requestTokens ?? 0;
  const contextTokens = preview?.contextTokens ?? latest?.contextTokens ?? 0;
  const contextLimit = preview?.contextLimit ?? analytics?.contextLimit ?? 1_000_000;
  const contextPercent = Math.min((contextTokens / contextLimit) * 100, 100);

  return (
    <div className="flex min-h-0 flex-col px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
            Token telemetry
          </p>
          <h2 className="mt-1 text-base font-semibold tracking-tight">Рост контекста</h2>
        </div>
        {loading && (
          <span className="text-xs text-muted" role="status">
            Обновление…
          </span>
        )}
      </div>

      {error && (
        <div
          className="mt-4 rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs leading-relaxed text-red-200"
          role="alert"
        >
          {error}
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <article className="rounded-xl border border-line bg-background/60 p-3">
          <GaugeIcon className="text-accent" size={18} aria-hidden />
          <p className="mt-3 font-mono text-lg font-semibold">{formatTokens(promptTokens)}</p>
          <p className="mt-0.5 text-[11px] text-muted">
            prompt tokens ·{" "}
            {preview || latest === null || latest.providerPromptTokens === null
              ? "estimate"
              : "provider"}
          </p>
        </article>
        <article className="rounded-xl border border-line bg-background/60 p-3">
          <CoinsIcon className="text-accent" size={18} aria-hidden />
          <p className="mt-3 font-mono text-lg font-semibold">
            {formatCost(analytics?.totals.costMicrosUsd ?? 0)}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">накопительная стоимость</p>
        </article>
      </div>

      <section className="mt-3 rounded-xl border border-line bg-background/60 p-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium">Context window</p>
            <p className="mt-1 font-mono text-[11px] text-muted">
              {formatTokens(contextTokens)} / {formatTokens(contextLimit)}
            </p>
          </div>
          <p className="font-mono text-sm font-semibold">{contextPercent.toFixed(2)}%</p>
        </div>
        <div
          className="mt-3 h-2 overflow-hidden rounded-full bg-white/5"
          role="progressbar"
          aria-label="Использование context window"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Number(contextPercent.toFixed(2))}
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300 motion-reduce:transition-none"
            style={{ width: `${contextPercent}%` }}
          />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] text-muted">
          <span>История {formatTokens(historyTokens)}</span>
          <span>Запрос {formatTokens(requestTokens)}</span>
          <span>Резерв {formatTokens(preview?.reservedOutputTokens ?? latest?.reservedOutputTokens ?? 4_096)}</span>
        </div>
      </section>

      <section className="mt-5 min-h-0">
        <div className="flex items-center gap-2">
          <ChartBarIcon className="text-accent" size={17} aria-hidden />
          <h3 className="text-sm font-semibold">Обмены</h3>
          <span className="ml-auto rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-muted">
            {analytics?.exchanges.length ?? 0}
          </span>
        </div>

        <div className="mt-3 flex flex-col gap-3">
          {!analytics?.exchanges.length ? (
            <div className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs leading-relaxed text-muted">
              Отправьте сообщение: здесь появятся request, history и response tokens.
            </div>
          ) : (
            analytics.exchanges.map((exchange, index) => {
              const responseTokens =
                exchange.providerCompletionTokens ?? exchange.responseTokens;
              const barTotal = Math.max(
                exchange.systemTokens +
                  exchange.historyTokens +
                  exchange.requestTokens +
                  responseTokens,
                1,
              );
              const segments = [
                { label: "system", value: exchange.systemTokens, className: "bg-white/35" },
                { label: "history", value: exchange.historyTokens, className: "bg-accent/55" },
                { label: "request", value: exchange.requestTokens, className: "bg-accent" },
                { label: "response", value: responseTokens, className: "bg-violet-400" },
              ];

              return (
                <article key={exchange.id} className="rounded-xl border border-line p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium">Обмен {index + 1}</p>
                    <span className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[9px] text-muted">
                      {exchange.source}
                    </span>
                  </div>
                  <div
                    className="mt-2 flex h-2 overflow-hidden rounded-full bg-white/5"
                    aria-label={segments
                      .map((segment) => `${segment.label}: ${formatTokens(segment.value)}`)
                      .join(", ")}
                  >
                    {segments.map((segment) => (
                      <span
                        key={segment.label}
                        className={segment.className}
                        style={{ width: `${(segment.value / barTotal) * 100}%` }}
                      />
                    ))}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[9px] text-muted">
                    {segments.map((segment) => (
                      <span key={segment.label}>
                        {segment.label} {formatTokens(segment.value)}
                        {segment.label === "response" ? "" : " ≈"}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 flex justify-between border-t border-line pt-2 font-mono text-[9px] text-muted">
                    <span>Σ {formatTokens(exchange.cumulativePromptTokens + exchange.cumulativeResponseTokens)}</span>
                    <span>{formatCost(exchange.cumulativeCostMicrosUsd)}</span>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}

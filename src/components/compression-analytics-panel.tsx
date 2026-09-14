import type {
  CompressionHeaderPreview,
  ConversationCompressionAnalytics,
} from "@/lib/compression-types";

type Props = {
  analytics: ConversationCompressionAnalytics | null;
  preview: CompressionHeaderPreview | null;
  loading: boolean;
  error: string | null;
};

function formatTokens(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatCost(value: number): string {
  return `$${(value / 1_000_000).toFixed(6)}`;
}

export function CompressionAnalyticsPanel({ analytics, preview, loading, error }: Props) {
  const latest = analytics?.exchanges.at(-1) ?? null;
  const full = preview?.fullPromptTokens ?? latest?.fullPromptTokens ?? 0;
  const compressed = preview?.compressedPromptTokens ?? latest?.compressedPromptTokens ?? 0;
  const saved = preview?.grossSavedTokens ?? latest?.grossSavedTokens ?? 0;
  const savedPercent = full > 0 ? (saved / full) * 100 : 0;
  const summarized =
    preview?.summarizedMessageCount ?? analytics?.summarizedMessageCount ?? 0;
  const rawTail = preview?.rawTailMessageCount ?? analytics?.rawTailMessageCount ?? 0;

  return (
    <section className="px-4 py-4" aria-labelledby="compression-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
            Context compression
          </p>
          <h2 id="compression-title" className="mt-1 text-base font-semibold">
            Summary + последние 10
          </h2>
        </div>
        {loading && <span className="text-xs text-muted">Обновление…</span>}
      </div>

      {error && (
        <p className="mt-3 rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200" role="alert">
          {error}
        </p>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Metric label="Полный prompt" value={formatTokens(full)} />
        <Metric label="Сжатый prompt" value={formatTokens(compressed)} />
        <Metric
          label="Экономия"
          value={`${saved >= 0 ? "+" : ""}${formatTokens(saved)}`}
          detail={`${savedPercent.toFixed(1)}%`}
          accent
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl border border-line bg-background/60 p-3">
          <p className="text-muted">Сжато сообщений</p>
          <p className="mt-1 font-mono text-lg font-semibold">{summarized}</p>
        </div>
        <div className="rounded-xl border border-line bg-background/60 p-3">
          <p className="text-muted">Raw buffer</p>
          <p className="mt-1 font-mono text-lg font-semibold">{rawTail}</p>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-line p-3 text-xs">
        <div className="flex justify-between gap-3">
          <span className="text-muted">Summary overhead</span>
          <span className="font-mono">
            {formatTokens(
              (analytics?.totals.summaryPromptTokens ?? 0) +
                (analytics?.totals.summaryCompletionTokens ?? 0),
            )}
          </span>
        </div>
        <div className="mt-2 flex justify-between gap-3">
          <span className="text-muted">Стоимость summary</span>
          <span className="font-mono">
            {formatCost(analytics?.totals.summaryCostMicrosUsd ?? 0)}
          </span>
        </div>
        <div className="mt-2 flex justify-between gap-3">
          <span className="text-muted">Стоимость ответов</span>
          <span className="font-mono">
            {formatCost(analytics?.totals.compressedCostMicrosUsd ?? 0)}
          </span>
        </div>
      </div>

      {analytics?.latestSummary ? (
        <details className="mt-3 rounded-xl border border-line">
          <summary className="flex min-h-11 cursor-pointer items-center px-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            Последний summary · cursor {analytics.latestSummary.summarizedThroughMessageId}
          </summary>
          <p className="break-words border-t border-line px-3 py-3 text-xs leading-relaxed text-muted">
            {analytics.latestSummary.content}
          </p>
        </details>
      ) : (
        <p className="mt-3 rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs leading-relaxed text-muted">
          До 20 сообщений используется полная история; savings и overhead равны нулю.
        </p>
      )}

      <div className="mt-4 space-y-3">
        {analytics?.exchanges.slice(-6).map((exchange, index) => {
          const maximum = Math.max(exchange.fullPromptTokens, exchange.compressedPromptTokens, 1);
          return (
            <article key={exchange.assistantMessageId} className="rounded-xl border border-line p-3">
              <p className="text-xs font-medium">Обмен {analytics.exchanges.length - Math.min(6, analytics.exchanges.length) + index + 1}</p>
              <Bar label="Полная история" value={exchange.fullPromptTokens} maximum={maximum} />
              <Bar label="Summary + хвост" value={exchange.compressedPromptTokens} maximum={maximum} accent />
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Metric({ label, value, detail, accent = false }: { label: string; value: string; detail?: string; accent?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-background/60 p-3">
      <p className={`truncate font-mono text-base font-semibold ${accent ? "text-accent" : ""}`}>{value}</p>
      <p className="mt-1 text-[10px] text-muted">{label}</p>
      {detail && <p className="mt-1 font-mono text-[10px] text-muted">{detail}</p>}
    </div>
  );
}

function Bar({ label, value, maximum, accent = false }: { label: string; value: number; maximum: number; accent?: boolean }) {
  return (
    <div className="mt-2">
      <div className="flex justify-between gap-2 font-mono text-[10px] text-muted">
        <span>{label}</span><span>{formatTokens(value)}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/5">
        <div className={`h-full rounded-full ${accent ? "bg-accent" : "bg-white/35"}`} style={{ width: `${(value / maximum) * 100}%` }} />
      </div>
    </div>
  );
}

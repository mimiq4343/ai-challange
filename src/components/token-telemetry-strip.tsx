import type {
  ConversationUsageAnalytics,
  TokenBreakdown,
} from "@/lib/conversation-types";

type TokenTelemetryStripProps = {
  analytics: ConversationUsageAnalytics | null;
  preview: TokenBreakdown | null;
  loading: boolean;
};

function formatTokens(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

export function TokenTelemetryStrip({
  analytics,
  preview,
  loading,
}: TokenTelemetryStripProps) {
  const latest = analytics?.exchanges.at(-1) ?? null;

  if (!preview && !latest) {
    return (
      <div className="border-t border-line/60 px-3 py-1.5">
        <p className="mx-auto w-full max-w-[820px] font-mono text-[10px] text-muted/80">
          Токены: отправьте сообщение — покажем prompt, историю, ответ и стоимость.
        </p>
      </div>
    );
  }

  const promptTokens =
    preview?.promptTokens ?? latest?.providerPromptTokens ?? latest?.promptTokens ?? 0;
  const source: "estimate" | "provider" =
    preview || !latest || latest.providerPromptTokens === null ? "estimate" : "provider";
  const historyTokens = preview?.historyTokens ?? latest?.historyTokens ?? 0;
  const requestTokens = preview?.requestTokens ?? latest?.requestTokens ?? 0;
  const responseTokens = preview
    ? 0
    : (latest?.providerCompletionTokens ?? latest?.responseTokens ?? 0);
  const contextTokens = preview?.contextTokens ?? latest?.contextTokens ?? 0;
  const contextLimit = preview?.contextLimit ?? analytics?.contextLimit ?? 1_000_000;
  const contextPercent = Math.min((contextTokens / contextLimit) * 100, 100);

  return (
    <div className="border-t border-line/60 px-3 py-1.5">
      <div className="mx-auto flex w-full max-w-[820px] flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-muted">
        <span className="text-foreground/80">
          prompt {formatTokens(promptTokens)}
          <span className="text-muted/70"> · {source}</span>
        </span>
        <span>история {formatTokens(historyTokens)}</span>
        <span>запрос {formatTokens(requestTokens)}</span>
        <span>ответ {formatTokens(responseTokens)}</span>
        <span>
          {`$${((analytics?.totals.costMicrosUsd ?? 0) / 1_000_000).toFixed(6)}`}
        </span>
        <span className="flex min-w-32 flex-1 items-center gap-1.5">
          <span
            className="h-1 min-w-16 flex-1 overflow-hidden rounded-full bg-white/5"
            role="progressbar"
            aria-label="Использование context window"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Number(contextPercent.toFixed(2))}
          >
            <span
              className="block h-full rounded-full bg-accent transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${contextPercent}%` }}
            />
          </span>
          {contextPercent.toFixed(2)}%
        </span>
        {loading && <span role="status">обновление…</span>}
      </div>
    </div>
  );
}

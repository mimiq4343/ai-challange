"use client";

import { useEffect, useRef, useState } from "react";
import { CompressionAnalyticsPanel } from "@/components/compression-analytics-panel";
import { CompressionBenchmarkPanel } from "@/components/compression-benchmark-panel";
import {
  ConversationWorkspace,
  type ConversationWorkspaceEvents,
  type MessageTokenBadge,
} from "@/components/conversation-workspace";
import type {
  CompressionHeaderPreview,
  CompressionRun,
  ConversationCompressionAnalytics,
} from "@/lib/compression-types";
import type {
  ConversationDetail,
  ConversationSummary,
  TokenBreakdown,
} from "@/lib/conversation-types";

type Props = {
  initialConversations: ConversationSummary[];
  initialDetail: ConversationDetail | null;
  initialAnalytics: ConversationCompressionAnalytics | null;
  initialRun: CompressionRun | null;
  model: string | null;
};

const COMPRESSION_HEADERS = {
  summaryTokens: "X-Compression-Summary",
  rawTailTokens: "X-Compression-Raw-Tail",
  effectiveHistoryTokens: "X-Compression-Effective-History",
  grossSavedTokens: "X-Compression-Saved",
  rawTailMessageCount: "X-Compression-Raw-Tail-Messages",
  summarizedMessageCount: "X-Compression-Summarized-Messages",
} as const;

function readCompressionPreview(headers: Headers): CompressionHeaderPreview | null {
  const compressedPromptTokens = Number(headers.get("X-Token-Prompt"));
  const values = Object.fromEntries(
    Object.entries(COMPRESSION_HEADERS).map(([field, header]) => [field, Number(headers.get(header))]),
  ) as Omit<CompressionHeaderPreview, "fullPromptTokens" | "compressedPromptTokens">;
  const unsigned = [
    compressedPromptTokens,
    values.summaryTokens,
    values.rawTailTokens,
    values.effectiveHistoryTokens,
    values.rawTailMessageCount,
    values.summarizedMessageCount,
  ];
  if (unsigned.some((value) => !Number.isSafeInteger(value) || value < 0) || !Number.isSafeInteger(values.grossSavedTokens)) return null;
  const fullPromptTokens = compressedPromptTokens + values.grossSavedTokens;
  if (!Number.isSafeInteger(fullPromptTokens) || fullPromptTokens < 0) return null;
  return { ...values, fullPromptTokens, compressedPromptTokens };
}

export function Day9Workspace({ initialConversations, initialDetail, initialAnalytics, initialRun, model }: Props) {
  const [analytics, setAnalytics] = useState(initialAnalytics);
  const [preview, setPreview] = useState<CompressionHeaderPreview | null>(null);
  const [tokenPreview, setTokenPreview] = useState<TokenBreakdown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function loadAnalytics(conversationId: string) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/compression`, { cache: "no-store", signal: controller.signal });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload || typeof payload !== "object" || !("analytics" in payload)) throw new Error(payload && typeof payload === "object" && "error" in payload ? String(payload.error) : `Сервер вернул ${response.status}.`);
      setAnalytics(payload.analytics as ConversationCompressionAnalytics);
      setPreview(null);
      setTokenPreview(null);
    } catch (loadError) {
      if (!(loadError instanceof DOMException && loadError.name === "AbortError")) setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить аналитику.");
    } finally {
      if (abortRef.current === controller) { abortRef.current = null; setLoading(false); }
    }
  }

  const events: ConversationWorkspaceEvents = {
    onConversationChange(conversationId) {
      setAnalytics(null); setPreview(null); setTokenPreview(null); setError(null);
      if (conversationId) void loadAnalytics(conversationId);
    },
    onUsagePreview(_conversationId, breakdown) { setTokenPreview(breakdown); },
    onResponseHeaders(_conversationId, headers) { setPreview(readCompressionPreview(headers)); },
    onExchangeComplete(conversationId) { void loadAnalytics(conversationId); },
    onExchangeFailed(conversationId) { void loadAnalytics(conversationId); },
  };
  const badges: MessageTokenBadge[] = analytics?.exchanges.map((exchange) => ({
    requestTokens: exchange.requestTokens,
    responseTokens: exchange.providerCompletionTokens ?? exchange.responseTokens,
    source: exchange.source,
  })) ?? [];
  if (tokenPreview) badges.push({ requestTokens: tokenPreview.requestTokens, responseTokens: 0, source: "estimated" });

  return (
    <div className="grid h-full min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_30rem]">
      <div className="min-h-0 min-w-0">
        <ConversationWorkspace initialConversations={initialConversations} initialDetail={initialDetail} model={model} events={events} messageRoute="compressed-messages" messageTokenBadges={badges} />
      </div>
      <aside className="hidden min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_24px_80px_rgba(3,5,16,0.55)] xl:flex" aria-label="Сжатие истории">
        <div className="chat-scroll min-h-0 flex-1 overflow-y-auto">
          <CompressionAnalyticsPanel analytics={analytics} preview={preview} loading={loading} error={error} />
          <CompressionBenchmarkPanel initialRun={initialRun} />
        </div>
      </aside>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { ChartLineUpIcon, XIcon } from "@phosphor-icons/react";

import {
  ConversationWorkspace,
  type ConversationWorkspaceEvents,
  type MessageTokenBadge,
} from "@/components/conversation-workspace";
import { TokenAnalyticsPanel } from "@/components/token-analytics-panel";
import { TokenComparison } from "@/components/token-comparison";
import type {
  ConversationDetail,
  ConversationSummary,
  ConversationUsageAnalytics,
  TokenBreakdown,
  TokenComparisonResponse,
} from "@/lib/conversation-types";

type Day8WorkspaceProps = {
  initialConversations: ConversationSummary[];
  initialDetail: ConversationDetail | null;
  initialAnalytics: ConversationUsageAnalytics | null;
  initialComparison: TokenComparisonResponse;
  model: string | null;
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String(payload.error)
        : `Сервер вернул ${response.status}.`;
    throw new Error(message);
  }
  return payload as T;
}

export function Day8Workspace({
  initialConversations,
  initialDetail,
  initialAnalytics,
  initialComparison,
  model,
}: Day8WorkspaceProps) {
  const [analytics, setAnalytics] = useState(initialAnalytics);
  const [preview, setPreview] = useState<TokenBreakdown | null>(null);
  const [comparison, setComparison] = useState(initialComparison);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [runningOverflow, setRunningOverflow] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [mobileAnalyticsOpen, setMobileAnalyticsOpen] = useState(false);
  const analyticsAbortRef = useRef<AbortController | null>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => () => analyticsAbortRef.current?.abort(), []);

  useEffect(() => {
    if (!mobileAnalyticsOpen) return;
    const sheet = sheetRef.current;
    sheet?.querySelector<HTMLElement>(".chat-scroll")?.scrollTo({ top: 0 });
    sheet?.querySelector<HTMLElement>("[data-mobile-sheet-close]")?.focus();
  }, [mobileAnalyticsOpen]);

  async function loadAnalytics(conversationId: string): Promise<void> {
    analyticsAbortRef.current?.abort();
    const controller = new AbortController();
    analyticsAbortRef.current = controller;
    setLoadingAnalytics(true);
    setAnalyticsError(null);
    try {
      const response = await fetch(`/api/conversations/${conversationId}/usage`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const result = await readJson<{ analytics: ConversationUsageAnalytics }>(response);
      setAnalytics(result.analytics);
      setPreview(null);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setAnalyticsError(
          error instanceof Error ? error.message : "Не удалось загрузить метрики.",
        );
      }
    } finally {
      if (analyticsAbortRef.current === controller) {
        analyticsAbortRef.current = null;
        setLoadingAnalytics(false);
      }
    }
  }

  const events: ConversationWorkspaceEvents = {
    onConversationChange(conversationId) {
      setPreview(null);
      setAnalytics(null);
      setAnalyticsError(null);
      if (conversationId) void loadAnalytics(conversationId);
    },
    onUsagePreview(_conversationId, breakdown) {
      setPreview(breakdown);
    },
    onExchangeComplete(conversationId) {
      void loadAnalytics(conversationId);
    },
    onExchangeFailed(conversationId) {
      void loadAnalytics(conversationId);
    },
  };

  const messageTokenBadges: MessageTokenBadge[] =
    analytics?.exchanges.map((exchange) => ({
      requestTokens: exchange.requestTokens,
      responseTokens: exchange.providerCompletionTokens ?? exchange.responseTokens,
      source: exchange.source,
    })) ?? [];
  if (preview) {
    messageTokenBadges.push({
      requestTokens: preview.requestTokens,
      responseTokens: 0,
      source: "estimated",
    });
  }

  async function runOverflow(): Promise<void> {
    setRunningOverflow(true);
    setAnalyticsError(null);
    try {
      const response = await fetch("/api/token-experiments/overflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      });
      const payload = await response.json().catch(() => null);
      if (payload && typeof payload === "object" && "run" in payload) {
        setComparison((current) => ({
          ...current,
          latestOverflowRun: payload.run as TokenComparisonResponse["latestOverflowRun"],
        }));
        return;
      }
      const message =
        payload && typeof payload === "object" && "error" in payload
          ? String(payload.error)
          : `Сервер вернул ${response.status}.`;
      throw new Error(message);
    } catch (error) {
      setAnalyticsError(
        error instanceof Error ? error.message : "Не удалось выполнить overflow-тест.",
      );
    } finally {
      setRunningOverflow(false);
    }
  }

  function closeMobileAnalytics() {
    setMobileAnalyticsOpen(false);
    triggerRef.current?.focus();
  }

  function handleSheetKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMobileAnalytics();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1) as HTMLElement;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="relative grid h-full min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-h-0 min-w-0">
        <ConversationWorkspace
          initialConversations={initialConversations}
          initialDetail={initialDetail}
          model={model}
          events={events}
          messageTokenBadges={messageTokenBadges}
        />
      </div>

      {mobileAnalyticsOpen && (
        <button
          type="button"
          aria-label="Закрыть аналитику"
          onClick={closeMobileAnalytics}
          className="fixed inset-0 z-30 cursor-default bg-black/70 xl:hidden"
        />
      )}

      <aside
        ref={sheetRef}
        aria-label="Аналитика токенов"
        aria-modal={mobileAnalyticsOpen || undefined}
        role={mobileAnalyticsOpen ? "dialog" : undefined}
        onKeyDown={handleSheetKeyDown}
        className={`${
          mobileAnalyticsOpen
            ? "fixed inset-x-2 bottom-2 top-[10dvh] z-40 flex"
            : "hidden xl:flex"
        } min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_24px_80px_rgba(3,5,16,0.55)]`}
      >
        <button
          data-mobile-sheet-close
          type="button"
          onClick={closeMobileAnalytics}
          aria-label="Закрыть аналитику"
          className="absolute right-3 top-3 z-10 flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl border border-line bg-surface text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent xl:hidden"
        >
          <XIcon size={18} aria-hidden />
        </button>
        <div className="chat-scroll min-h-0 flex-1 overflow-y-auto">
          <TokenAnalyticsPanel
            analytics={analytics}
            preview={preview}
            loading={loadingAnalytics}
            error={analyticsError}
          />
          <div className="border-t border-line px-4 pb-5">
            <TokenComparison
              comparison={comparison}
              running={runningOverflow}
              onRunOverflow={runOverflow}
            />
          </div>
        </div>
      </aside>

      <button
        ref={triggerRef}
        type="button"
        aria-label="Открыть аналитику токенов"
        aria-expanded={mobileAnalyticsOpen}
        onClick={() => setMobileAnalyticsOpen(true)}
        className="absolute right-3 top-2 flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl border border-accent/25 bg-surface text-accent shadow-lg transition-colors hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent xl:hidden"
      >
        <ChartLineUpIcon size={19} weight="bold" aria-hidden />
      </button>
    </div>
  );
}

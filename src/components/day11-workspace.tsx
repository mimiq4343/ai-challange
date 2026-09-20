"use client";

import { useEffect, useRef, useState } from "react";
import { BrainIcon, XIcon } from "@phosphor-icons/react";

import {
  ConversationWorkspace,
  type ConversationWorkspaceEvents,
} from "@/components/conversation-workspace";
import { MemoryPanel } from "@/components/memory-panel";
import { TokenTelemetryStrip } from "@/components/token-telemetry-strip";
import type {
  ConversationDetail,
  ConversationSummary,
  ConversationUsageAnalytics,
  LongTermMemoryCategory,
  MemorySnapshot,
  TokenBreakdown,
} from "@/lib/conversation-types";

type Day11WorkspaceProps = {
  initialConversations: ConversationSummary[];
  initialDetail: ConversationDetail | null;
  initialAnalytics: ConversationUsageAnalytics | null;
  initialMemory: MemorySnapshot;
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

export function Day11Workspace({
  initialConversations,
  initialDetail,
  initialAnalytics,
  initialMemory,
  model,
}: Day11WorkspaceProps) {
  const [analytics, setAnalytics] = useState(initialAnalytics);
  const [preview, setPreview] = useState<TokenBreakdown | null>(null);
  const [memory, setMemory] = useState<MemorySnapshot>(initialMemory);
  const [activeId, setActiveId] = useState(initialDetail?.conversation.id ?? null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [loadingMemory, setLoadingMemory] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [mobileMemoryOpen, setMobileMemoryOpen] = useState(false);
  const analyticsAbortRef = useRef<AbortController | null>(null);
  const memoryAbortRef = useRef<AbortController | null>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(
    () => () => {
      analyticsAbortRef.current?.abort();
      memoryAbortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (!mobileMemoryOpen) return;
    const sheet = sheetRef.current;
    sheet?.querySelector<HTMLElement>(".chat-scroll")?.scrollTo({ top: 0 });
    sheet?.querySelector<HTMLElement>("[data-mobile-sheet-close]")?.focus();
  }, [mobileMemoryOpen]);

  async function loadAnalytics(conversationId: string): Promise<void> {
    analyticsAbortRef.current?.abort();
    const controller = new AbortController();
    analyticsAbortRef.current = controller;
    setLoadingAnalytics(true);
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
        setPanelError(
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

  async function loadMemory(conversationId: string | null): Promise<void> {
    memoryAbortRef.current?.abort();
    const controller = new AbortController();
    memoryAbortRef.current = controller;
    setLoadingMemory(true);
    try {
      const query = conversationId ? `?conversationId=${conversationId}` : "";
      const response = await fetch(`/api/memory${query}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const result = await readJson<{ snapshot: MemorySnapshot }>(response);
      setMemory(result.snapshot);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setPanelError(
          error instanceof Error ? error.message : "Не удалось загрузить слои памяти.",
        );
      }
    } finally {
      if (memoryAbortRef.current === controller) {
        memoryAbortRef.current = null;
        setLoadingMemory(false);
      }
    }
  }

  const events: ConversationWorkspaceEvents = {
    onConversationChange(conversationId) {
      setActiveId(conversationId);
      setPreview(null);
      setAnalytics(null);
      setPanelError(null);
      void loadMemory(conversationId);
      if (conversationId) void loadAnalytics(conversationId);
    },
    onUsagePreview(_conversationId, breakdown) {
      setPreview(breakdown);
    },
    onExchangeComplete(conversationId) {
      void loadAnalytics(conversationId);
      void loadMemory(conversationId);
    },
    onExchangeFailed(conversationId) {
      void loadAnalytics(conversationId);
    },
  };

  async function mutateMemory(action: () => Promise<Response>): Promise<void> {
    setPanelError(null);
    try {
      await action();
      await loadMemory(activeId);
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Не удалось обновить память.");
      throw error;
    }
  }

  async function addLongTerm(
    category: LongTermMemoryCategory,
    content: string,
  ): Promise<void> {
    await mutateMemory(() =>
      fetch("/api/memory/long-term", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, content }),
      }).then(async (response) => {
        await readJson(response);
        return response;
      }),
    );
  }

  async function deleteLongTerm(id: number): Promise<void> {
    await mutateMemory(async () => {
      const response = await fetch(`/api/memory/long-term/${id}`, { method: "DELETE" });
      if (!response.ok) await readJson(response);
      return response;
    });
  }

  async function addWorking(content: string): Promise<void> {
    if (!activeId) return;
    const conversationId = activeId;
    await mutateMemory(() =>
      fetch("/api/memory/working", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, content }),
      }).then(async (response) => {
        await readJson(response);
        return response;
      }),
    );
  }

  async function deleteWorking(id: number): Promise<void> {
    await mutateMemory(async () => {
      const response = await fetch(`/api/memory/working/${id}`, { method: "DELETE" });
      if (!response.ok) await readJson(response);
      return response;
    });
  }

  function closeMobileMemory() {
    setMobileMemoryOpen(false);
    triggerRef.current?.focus();
  }

  function handleSheetKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMobileMemory();
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
          composerFooter={
            <TokenTelemetryStrip
              analytics={analytics}
              preview={preview}
              loading={loadingAnalytics}
            />
          }
        />
      </div>

      {mobileMemoryOpen && (
        <button
          type="button"
          aria-label="Закрыть панель памяти"
          onClick={closeMobileMemory}
          className="fixed inset-0 z-30 cursor-default bg-black/70 xl:hidden"
        />
      )}

      <aside
        ref={sheetRef}
        aria-label="Слои памяти агента"
        aria-modal={mobileMemoryOpen || undefined}
        role={mobileMemoryOpen ? "dialog" : undefined}
        onKeyDown={handleSheetKeyDown}
        className={`${
          mobileMemoryOpen
            ? "fixed inset-x-2 bottom-2 top-[10dvh] z-40 flex"
            : "hidden xl:flex"
        } min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_24px_80px_rgba(3,5,16,0.55)]`}
      >
        <button
          data-mobile-sheet-close
          type="button"
          onClick={closeMobileMemory}
          aria-label="Закрыть панель памяти"
          className="absolute right-3 top-3 z-10 flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl border border-line bg-surface text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent xl:hidden"
        >
          <XIcon size={18} aria-hidden />
        </button>
        <div className="chat-scroll min-h-0 flex-1 overflow-y-auto">
          <MemoryPanel
            snapshot={memory}
            loading={loadingMemory}
            error={panelError}
            hasActiveConversation={activeId !== null}
            onAddLongTerm={addLongTerm}
            onDeleteLongTerm={deleteLongTerm}
            onAddWorking={addWorking}
            onDeleteWorking={deleteWorking}
          />
        </div>
      </aside>

      <button
        ref={triggerRef}
        type="button"
        aria-label="Открыть слои памяти"
        aria-expanded={mobileMemoryOpen}
        onClick={() => setMobileMemoryOpen(true)}
        className="absolute right-3 top-2 flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl border border-accent/25 bg-surface text-accent shadow-lg transition-colors hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent xl:hidden"
      >
        <BrainIcon size={19} weight="bold" aria-hidden />
      </button>
    </div>
  );
}

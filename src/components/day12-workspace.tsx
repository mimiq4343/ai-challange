"use client";

import { useEffect, useRef, useState } from "react";
import { BrainIcon, XIcon } from "@phosphor-icons/react";

import {
  ConversationWorkspace,
  type ConversationWorkspaceEvents,
} from "@/components/conversation-workspace";
import { MemoryInspector } from "@/components/memory-inspector";
import {
  MemoryTelemetryBar,
  type MemoryTelemetrySource,
} from "@/components/memory-telemetry-bar";
import { ProfilePanel } from "@/components/profile-panel";
import type {
  ConversationDetail,
  ConversationSummary,
  ConversationUsageAnalytics,
} from "@/lib/conversation-types";
import {
  ALL_MEMORY_LAYERS_ENABLED,
  type ConversationMemorySnapshot,
  type LongTermKind,
  type MemoryLayerTokens,
  type MemoryLayerToggles,
  type WorkingSlotKind,
} from "@/lib/memory-types";
import type { ProfileEnumField, UserProfile } from "@/lib/profile-types";

type Day12WorkspaceProps = {
  initialConversations: ConversationSummary[];
  initialDetail: ConversationDetail | null;
  initialMemory: ConversationMemorySnapshot | null;
  initialProfiles: UserProfile[];
  initialTotalCostMicrosUsd: number;
  shortTermWindow: number;
  model: string | null;
};

const MEMORY_HEADERS = {
  systemTokens: "X-Token-System",
  profileTokens: "X-Memory-Prof",
  longTermTokens: "X-Memory-Ltm",
  workingTokens: "X-Memory-Wm",
  shortTermTokens: "X-Memory-Stm",
  requestTokens: "X-Token-Request",
  promptTokens: "X-Token-Prompt",
  reservedOutputTokens: "X-Token-Reserved-Output",
  contextTokens: "X-Token-Context",
  contextLimit: "X-Token-Limit",
} as const;

function readLayerTokens(headers: Headers): MemoryLayerTokens | null {
  const entries = Object.entries(MEMORY_HEADERS).map(([field, header]) => {
    const raw = headers.get(header);
    return [field, raw === null ? Number.NaN : Number(raw)] as const;
  });
  if (entries.some(([, value]) => !Number.isSafeInteger(value) || value < 0)) return null;
  return Object.fromEntries(entries) as MemoryLayerTokens;
}

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

export function Day12Workspace({
  initialConversations,
  initialDetail,
  initialMemory,
  initialProfiles,
  initialTotalCostMicrosUsd,
  shortTermWindow,
  model,
}: Day12WorkspaceProps) {
  const [layers, setLayers] = useState<MemoryLayerToggles>(ALL_MEMORY_LAYERS_ENABLED);
  const [profiles, setProfiles] = useState(initialProfiles);
  const [snapshot, setSnapshot] = useState(initialMemory);
  const [totalCost, setTotalCost] = useState(initialTotalCostMicrosUsd);
  const [preview, setPreview] = useState<MemoryLayerTokens | null>(null);
  const [previewMessages, setPreviewMessages] = useState<number | null>(null);
  const [updating, setUpdating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const activeIdRef = useRef(initialDetail?.conversation.id ?? null);
  const sheetRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const activeProfile = profiles.find((profile) => profile.active) ?? null;

  useEffect(() => {
    if (!inspectorOpen) return;
    const sheet = sheetRef.current;
    sheet?.querySelector<HTMLElement>(".chat-scroll")?.scrollTo({ top: 0 });
    sheet?.querySelector<HTMLElement>("[data-mobile-sheet-close]")?.focus();
  }, [inspectorOpen]);

  async function reloadProfiles(): Promise<void> {
    const result = await readJson<{ profiles: UserProfile[] }>(
      await fetch("/api/profiles", { cache: "no-store" }),
    );
    setProfiles(result.profiles);
  }

  async function reload(conversationId: string | null): Promise<void> {
    try {
      await reloadProfiles();
      if (!conversationId) {
        setSnapshot(null);
        setError(null);
        return;
      }

      const [memoryResult, usageResult] = await Promise.all([
        fetch(`/api/conversations/${conversationId}/memory`, { cache: "no-store" }).then(
          (response) => readJson<{ memory: ConversationMemorySnapshot }>(response),
        ),
        fetch(`/api/conversations/${conversationId}/usage`, { cache: "no-store" }).then(
          (response) => readJson<{ analytics: ConversationUsageAnalytics }>(response),
        ),
      ]);
      setSnapshot(memoryResult.memory);
      setTotalCost(usageResult.analytics.totals.costMicrosUsd);
      setError(null);
    } catch (reloadError) {
      setError(
        reloadError instanceof Error
          ? reloadError.message
          : "Не удалось загрузить состояние памяти.",
      );
    }
  }

  async function mutate(
    input: RequestInfo | URL,
    init: RequestInit,
    fallbackMessage: string,
  ): Promise<void> {
    setBusy(true);
    try {
      const response = await fetch(input, init);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(
          payload && typeof payload === "object" && "error" in payload
            ? String(payload.error)
            : fallbackMessage,
        );
      }
      setError(null);
      await reload(activeIdRef.current);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : fallbackMessage);
    } finally {
      setBusy(false);
    }
  }

  const events: ConversationWorkspaceEvents = {
    onConversationChange(conversationId) {
      activeIdRef.current = conversationId;
      setPreview(null);
      setPreviewMessages(null);
      setSnapshot(null);
      void reload(conversationId);
    },
    onResponseHeaders(_conversationId, headers) {
      const tokens = readLayerTokens(headers);
      if (tokens) setPreview(tokens);
      const stmMessages = Number(headers.get("X-Memory-Stm-Messages"));
      setPreviewMessages(Number.isSafeInteger(stmMessages) ? stmMessages : null);
      setUpdating(true);
    },
    onExchangeComplete(conversationId) {
      setUpdating(false);
      setPreview(null);
      setPreviewMessages(null);
      void reload(conversationId);
    },
    onExchangeFailed(conversationId) {
      setUpdating(false);
      void reload(conversationId);
    },
  };

  const storedUsage = snapshot?.latestUsage ?? null;
  const telemetryTokens: MemoryLayerTokens | null = preview ?? storedUsage;
  const telemetrySource: MemoryTelemetrySource | null = preview
    ? "preview"
    : storedUsage
      ? "stored"
      : null;

  function closeInspector() {
    setInspectorOpen(false);
    triggerRef.current?.focus();
  }

  function handleSheetKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeInspector();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
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

  const rail = (
    <>
      <ProfilePanel
        profiles={profiles}
        activeProfile={activeProfile}
        enabled={layers.profile}
        busy={busy}
        error={error}
        profileTokens={telemetryTokens?.profileTokens ?? null}
        onToggle={(enabled) =>
          setLayers((current) => ({ ...current, profile: enabled }))
        }
        onActivate={(profileId: number) =>
          mutate(
            `/api/profiles/${profileId}/activate`,
            { method: "POST" },
            "Не удалось переключить профиль.",
          )
        }
        onCreate={(name: string) =>
          mutate(
            "/api/profiles",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name }),
            },
            "Не удалось создать профиль.",
          )
        }
        onDelete={(profileId: number) =>
          mutate(
            `/api/profiles/${profileId}`,
            { method: "DELETE" },
            "Не удалось удалить профиль.",
          )
        }
        onUpdate={(
          profileId: number,
          patch: Partial<Record<ProfileEnumField | "role" | "name", string>>,
        ) => {
          const profile = profiles.find((item) => item.id === profileId);
          if (!profile) return Promise.resolve();
          return mutate(
            `/api/profiles/${profileId}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: profile.name,
                role: profile.role ?? "",
                tone: profile.tone,
                verbosity: profile.verbosity,
                format: profile.format,
                language: profile.language,
                expertise: profile.expertise,
                ...patch,
              }),
            },
            "Не удалось обновить профиль.",
          );
        }}
        onAddConstraint={(profileId: number, value: string) =>
          mutate(
            `/api/profiles/${profileId}/constraints`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ value }),
            },
            "Не удалось добавить ограничение.",
          )
        }
        onDeleteConstraint={(profileId: number, constraintId: number) =>
          mutate(
            `/api/profiles/${profileId}/constraints/${constraintId}`,
            { method: "DELETE" },
            "Не удалось удалить ограничение.",
          )
        }
      />
      <MemoryInspector
        snapshot={snapshot}
        layers={layers}
        busy={busy}
        error={null}
        onToggleLayer={(layer, enabled) =>
          setLayers((current) => ({ ...current, [layer]: enabled }))
        }
        onCreateLongTerm={(input: { kind: LongTermKind; key: string; value: string }) =>
          mutate(
            "/api/memory/long-term",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...input, conversationId: activeIdRef.current }),
            },
            "Не удалось сохранить запись.",
          )
        }
        onDeleteLongTerm={(id: number) =>
          mutate(
            `/api/memory/long-term/${id}`,
            { method: "DELETE" },
            "Не удалось удалить запись.",
          )
        }
        onSaveTask={(input: { title: string; goal: string }) =>
          mutate(
            `/api/conversations/${activeIdRef.current}/memory/task`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(input),
            },
            "Не удалось сохранить задачу.",
          )
        }
        onCloseTask={() =>
          mutate(
            `/api/conversations/${activeIdRef.current}/memory/task`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "close" }),
            },
            "Не удалось закрыть задачу.",
          )
        }
        onAddSlot={(input: { kind: WorkingSlotKind; value: string }) =>
          mutate(
            `/api/conversations/${activeIdRef.current}/memory/slots`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(input),
            },
            "Не удалось добавить слот.",
          )
        }
        onDeleteSlot={(id: number) =>
          mutate(
            `/api/conversations/${activeIdRef.current}/memory/slots/${id}`,
            { method: "DELETE" },
            "Не удалось удалить слот.",
          )
        }
      />
    </>
  );

  return (
    <div className="relative grid h-full min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_23rem]">
      <div className="min-h-0 min-w-0">
        <ConversationWorkspace
          initialConversations={initialConversations}
          initialDetail={initialDetail}
          model={model}
          events={events}
          messageRoute="personalized-messages"
          requestBodyExtra={{ layers }}
          inputFooter={
            <MemoryTelemetryBar
              tokens={telemetryTokens}
              source={telemetrySource}
              shortTermMessages={previewMessages ?? storedUsage?.shortTermMessages ?? null}
              windowMessages={shortTermWindow}
              routerCostMicrosUsd={storedUsage?.router?.costMicrosUsd ?? null}
              totalCostMicrosUsd={totalCost}
              updating={updating}
            />
          }
        />
      </div>

      {inspectorOpen && (
        <button
          type="button"
          aria-label="Закрыть инспектор памяти"
          onClick={closeInspector}
          className="fixed inset-0 z-30 cursor-default bg-black/70 xl:hidden"
        />
      )}

      <aside
        ref={sheetRef}
        aria-label="Профиль и память"
        aria-modal={inspectorOpen || undefined}
        role={inspectorOpen ? "dialog" : undefined}
        onKeyDown={handleSheetKeyDown}
        className={`${
          inspectorOpen ? "fixed inset-x-2 bottom-2 top-[8dvh] z-40 flex" : "hidden xl:flex"
        } min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_24px_80px_rgba(3,5,16,0.55)]`}
      >
        <button
          data-mobile-sheet-close
          type="button"
          onClick={closeInspector}
          aria-label="Закрыть инспектор памяти"
          className="absolute right-3 top-3 z-10 flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl border border-line bg-surface text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent xl:hidden"
        >
          <XIcon size={18} aria-hidden />
        </button>
        <div className="chat-scroll min-h-0 flex-1 overflow-y-auto">{rail}</div>
      </aside>

      <button
        ref={triggerRef}
        type="button"
        aria-label="Открыть профиль и память"
        aria-expanded={inspectorOpen}
        onClick={() => setInspectorOpen(true)}
        className="absolute right-3 top-2 flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl border border-accent/25 bg-surface text-accent shadow-lg transition-colors hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent xl:hidden"
      >
        <BrainIcon size={19} weight="bold" aria-hidden />
      </button>
    </div>
  );
}

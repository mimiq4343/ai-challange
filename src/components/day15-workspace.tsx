"use client";

import { useRef, useState, type ReactNode } from "react";

import {
  ConversationWorkspace,
  type ConversationWorkspaceEvents,
} from "@/components/conversation-workspace";
import { MemoryInspector } from "@/components/memory-inspector";
import {
  MemoryTelemetryBar,
  type MemoryTelemetrySource,
} from "@/components/memory-telemetry-bar";
import { InvariantPanel } from "@/components/invariant-panel";
import { TaskStatePanel } from "@/components/task-state-panel";
import { WorkspaceInspector } from "@/components/workspace-inspector";
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
import type { InvariantInput, InvariantSnapshot } from "@/lib/invariant-types";
import type { TaskStage } from "@/lib/task-machine";
import type {
  TaskProposal,
  TaskSnapshot,
  TaskStepStatus,
} from "@/lib/task-types";

type Day15WorkspaceProps = {
  initialConversations: ConversationSummary[];
  initialDetail: ConversationDetail | null;
  initialMemory: ConversationMemorySnapshot | null;
  initialTask: TaskSnapshot | null;
  initialInvariants: InvariantSnapshot | null;
  initialProposal: TaskProposal | null;
  initialTotalCostMicrosUsd: number;
  shortTermWindow: number;
  model: string | null;
  inspectorExtra?: ReactNode;
};

const MEMORY_HEADERS = {
  systemTokens: "X-Token-System",
  profileTokens: "X-Memory-Prof",
  taskTokens: "X-Memory-Task",
  invariantTokens: "X-Memory-Inv",
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
  if (entries.some(([, value]) => !Number.isSafeInteger(value) || value < 0))
    return null;
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

export function Day15Workspace({
  initialConversations,
  initialDetail,
  initialMemory,
  initialTask,
  initialInvariants,
  initialProposal,
  initialTotalCostMicrosUsd,
  shortTermWindow,
  model,
  inspectorExtra,
}: Day15WorkspaceProps) {
  const [layers, setLayers] = useState<MemoryLayerToggles>(
    ALL_MEMORY_LAYERS_ENABLED,
  );
  const [task, setTask] = useState(initialTask);
  const [invariants, setInvariants] = useState(initialInvariants);
  const [proposal, setProposal] = useState(initialProposal);
  const [snapshot, setSnapshot] = useState(initialMemory);
  const [totalCost, setTotalCost] = useState(initialTotalCostMicrosUsd);
  const [preview, setPreview] = useState<MemoryLayerTokens | null>(null);
  const [previewMessages, setPreviewMessages] = useState<number | null>(null);
  const [updating, setUpdating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeIdRef = useRef(initialDetail?.conversation.id ?? null);

  async function reloadTask(): Promise<void> {
    const [taskResult, invariantResult] = await Promise.all([
      readJson<{ task: TaskSnapshot | null; proposal: TaskProposal | null }>(
        await fetch("/api/tasks", { cache: "no-store" }),
      ),
      readJson<{ invariants: InvariantSnapshot }>(
        await fetch("/api/invariants", { cache: "no-store" }),
      ),
    ]);
    setTask(taskResult.task);
    setProposal(taskResult.proposal);
    setInvariants(invariantResult.invariants);
  }

  async function reload(conversationId: string | null): Promise<void> {
    try {
      await reloadTask();
      if (!conversationId) {
        setSnapshot(null);
        setError(null);
        return;
      }

      const [memoryResult, usageResult] = await Promise.all([
        fetch(`/api/conversations/${conversationId}/memory`, {
          cache: "no-store",
        }).then((response) =>
          readJson<{ memory: ConversationMemorySnapshot }>(response),
        ),
        fetch(`/api/conversations/${conversationId}/usage`, {
          cache: "no-store",
        }).then((response) =>
          readJson<{ analytics: ConversationUsageAnalytics }>(response),
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
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : fallbackMessage,
      );
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
      setPreviewMessages(
        Number.isSafeInteger(stmMessages) ? stmMessages : null,
      );
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

  const rail = (
    <>
      {inspectorExtra}
      <InvariantPanel
        snapshot={invariants}
        enabled={layers.invariants}
        busy={busy}
        error={error}
        invariantTokens={telemetryTokens?.invariantTokens ?? null}
        onToggle={(enabled) =>
          setLayers((current) => ({ ...current, invariants: enabled }))
        }
        onCreate={(input: InvariantInput) =>
          mutate(
            "/api/invariants",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(input),
            },
            "Не удалось создать инвариант.",
          )
        }
        onUpdate={(id: number, input: InvariantInput) =>
          mutate(
            `/api/invariants/${id}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(input),
            },
            "Не удалось изменить инвариант.",
          )
        }
        onRetire={(id: number) =>
          mutate(
            `/api/invariants/${id}/retire`,
            { method: "POST" },
            "Не удалось снять инвариант.",
          )
        }
        onRestore={(id: number) =>
          mutate(
            `/api/invariants/${id}/restore`,
            { method: "POST" },
            "Не удалось вернуть инвариант.",
          )
        }
        onAcceptProposal={(id: number) =>
          mutate(
            `/api/invariants/proposals/${id}/accept`,
            { method: "POST" },
            "Не удалось принять предложение.",
          )
        }
        onRejectProposal={(id: number) =>
          mutate(
            `/api/invariants/proposals/${id}`,
            { method: "DELETE" },
            "Не удалось отклонить предложение.",
          )
        }
      />
      <TaskStatePanel
        task={task}
        proposal={proposal}
        enabled={layers.task}
        busy={busy}
        error={error}
        taskTokens={telemetryTokens?.taskTokens ?? null}
        onToggle={(enabled) =>
          setLayers((current) => ({ ...current, task: enabled }))
        }
        onApprovePlan={() =>
          task
            ? mutate(
                `/api/tasks/${task.run.id}/approve-plan`,
                { method: "POST" },
                "Не удалось утвердить план.",
              )
            : Promise.resolve()
        }
        onCreate={(title: string, goal: string) =>
          mutate(
            "/api/tasks",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title, goal }),
            },
            "Не удалось создать задачу.",
          )
        }
        onAcceptProposal={() =>
          mutate(
            "/api/tasks/proposal",
            { method: "POST" },
            "Не удалось завести задачу из предложения.",
          )
        }
        onRejectProposal={() =>
          mutate(
            "/api/tasks/proposal",
            { method: "DELETE" },
            "Не удалось отклонить предложение.",
          )
        }
        onTransition={(stage: TaskStage, reason: string) =>
          task
            ? mutate(
                `/api/tasks/${task.run.id}/transition`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ stage, reason }),
                },
                "Не удалось сменить этап.",
              )
            : Promise.resolve()
        }
        onPause={(paused: boolean) =>
          task
            ? mutate(
                `/api/tasks/${task.run.id}/${paused ? "pause" : "resume"}`,
                { method: "POST" },
                "Не удалось изменить паузу.",
              )
            : Promise.resolve()
        }
        onAddStep={(title: string) =>
          task
            ? mutate(
                `/api/tasks/${task.run.id}/steps`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ title }),
                },
                "Не удалось добавить шаг.",
              )
            : Promise.resolve()
        }
        onUpdateStep={(stepId: number, status: TaskStepStatus) =>
          task
            ? mutate(
                `/api/tasks/${task.run.id}/steps/${stepId}`,
                {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ status }),
                },
                "Не удалось обновить шаг.",
              )
            : Promise.resolve()
        }
        onDeleteStep={(stepId: number) =>
          task
            ? mutate(
                `/api/tasks/${task.run.id}/steps/${stepId}`,
                { method: "DELETE" },
                "Не удалось удалить шаг.",
              )
            : Promise.resolve()
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
        onCreateLongTerm={(input: {
          kind: LongTermKind;
          key: string;
          value: string;
        }) =>
          mutate(
            "/api/memory/long-term",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...input,
                conversationId: activeIdRef.current,
              }),
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
    <WorkspaceInspector
      inspector={rail}
      label={
        inspectorExtra
          ? "MCP, инварианты, задача и память"
          : "Инварианты, задача и память"
      }
    >
      <ConversationWorkspace
        initialConversations={initialConversations}
        initialDetail={initialDetail}
        model={model}
        events={events}
        messageRoute="invariant-messages"
        requestBodyExtra={{ layers }}
        inputFooter={
          <MemoryTelemetryBar
            tokens={telemetryTokens}
            source={telemetrySource}
            shortTermMessages={
              previewMessages ?? storedUsage?.shortTermMessages ?? null
            }
            windowMessages={shortTermWindow}
            routerCostMicrosUsd={storedUsage?.router?.costMicrosUsd ?? null}
            totalCostMicrosUsd={totalCost}
            updating={updating}
          />
        }
      />
    </WorkspaceInspector>
  );
}

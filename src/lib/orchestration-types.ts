import type { OrchestrationServerId } from "./orchestration-config";

export type McpServerStatus =
  | { id: OrchestrationServerId; name: string; status: "available"; tools: string[] }
  | { id: OrchestrationServerId; name: string; status: "unavailable"; error: string };

export type OrchestrationCall = {
  step: number;
  callId: string;
  serverId: OrchestrationServerId;
  tool: string;
  arguments: Record<string, unknown>;
  status: "running" | "ok" | "error";
  startedAt: string;
  finishedAt: string | null;
};

export type OrchestrationRun = {
  runId: string;
  conversationId: string;
  request: string;
  /** interrupted: запуск не завершился до общего дедлайна, например после перезапуска сервера. */
  status: "running" | "completed" | "failed" | "interrupted";
  error: string | null;
  servers: McpServerStatus[] | null;
  calls: OrchestrationCall[];
  createdAt: string;
  finishedAt: string | null;
};

import "server-only";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { McpConnectionError, withMcpTools, type McpToolSession } from "./mcp-client";
import { McpValidationError } from "./mcp-network";
import type { McpTool } from "./mcp-types";
import type { OrchestrationServer, OrchestrationServerId } from "./orchestration-config";
import type { McpServerStatus } from "./orchestration-types";
import { orchestrationToolName, parseOrchestrationToolName } from "./orchestration-tools";

export type RoutedMcpServer = OrchestrationServer & { authorization?: { token: string; profileId: number } };

export type McpRouterSession = {
  statuses: McpServerStatus[];
  /** Инструменты доступных серверов с именами вида server__tool. */
  tools: McpTool[];
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
};

function describeFailure(server: RoutedMcpServer, error: unknown): string {
  if (error instanceof McpConnectionError || error instanceof McpValidationError) return error.message;
  console.error("Не удалось подключиться к MCP-серверу оркестрации.", {
    serverId: server.id,
    error: error instanceof Error ? error.name : "UnknownError",
  });
  return "Не удалось подключиться к MCP-серверу.";
}

// Все серверы подключаются параллельно и держат сессии до конца operation.
// Недоступный сервер не прерывает запуск: его инструменты исчезают из каталога,
// а статус с причиной получает агент.
export async function withMcpRouter<T>(
  servers: readonly RoutedMcpServer[],
  callerSignal: AbortSignal,
  operation: (router: McpRouterSession) => Promise<T>,
): Promise<T> {
  callerSignal.throwIfAborted();
  if (new Set(servers.map(({ id }) => id)).size !== servers.length) {
    throw new Error("Идентификаторы MCP-серверов оркестрации должны быть уникальны.");
  }
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  const connections = servers.map((server) => {
    let opened!: (session: McpToolSession) => void;
    const ready = new Promise<McpToolSession>((resolve) => { opened = resolve; });
    const closed = withMcpTools(server.url, callerSignal, async (session) => {
      opened(session);
      await released;
    }, server.authorization);
    // Сбой подключения завершает closed раньше, чем появится сессия.
    const session = Promise.race([ready, closed.then((): never => {
      throw new McpConnectionError("MCP-сессия закрылась до начала работы.", 502);
    })]);
    return { server, session, closed };
  });

  const sessions = new Map<OrchestrationServerId, { server: RoutedMcpServer; session: McpToolSession }>();
  let result: T | undefined;
  let failed = false;
  let failure: unknown;
  try {
    const settled = await Promise.allSettled(connections.map(({ session }) => session));
    callerSignal.throwIfAborted();
    const statuses = settled.map((outcome, index): McpServerStatus => {
      const { server } = connections[index];
      if (outcome.status === "rejected") {
        return { id: server.id, name: server.name, status: "unavailable", error: describeFailure(server, outcome.reason) };
      }
      sessions.set(server.id, { server, session: outcome.value });
      return { id: server.id, name: server.name, status: "available", tools: outcome.value.tools.map(({ name }) => name) };
    });
    const tools = [...sessions.values()].flatMap(({ server, session }) =>
      session.tools.map((tool) => ({ ...tool, name: orchestrationToolName(server.id, tool.name) })));
    result = await operation({
      statuses,
      tools,
      async callTool(name, args) {
        const route = parseOrchestrationToolName(name);
        const target = route && sessions.get(route.serverId);
        if (!route || !target) throw new McpConnectionError("Инструмент не принадлежит доступному MCP-серверу.", 502);
        try {
          return await target.session.callTool(route.tool, args);
        } catch (error) {
          if (callerSignal.aborted || !(error instanceof McpConnectionError)) throw error;
          // Сбой одного сервера — результат шага для модели, а не конец всего флоу.
          return { content: [{ type: "text", text: `${target.server.name}: ${error.message}` }], isError: true };
        }
      },
    });
  } catch (error) {
    failed = true;
    failure = error;
  }

  release();
  const closing = await Promise.allSettled(connections.map(({ closed }) => closed));
  if (callerSignal.aborted) throw callerSignal.reason;
  if (failed) throw failure;
  const cleanupErrors = closing.flatMap((outcome, index) =>
    outcome.status === "rejected" && sessions.has(connections[index].server.id) ? [outcome.reason] : []);
  if (cleanupErrors.length > 0) {
    throw new McpConnectionError("Не удалось корректно закрыть MCP-сессию.", 502, {
      cause: new AggregateError(cleanupErrors, "MCP router cleanup failed"),
    });
  }
  return result as T;
}

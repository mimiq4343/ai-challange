import "server-only";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { resolve } from "node:path";

import { PROJECT_MCP_LIMITS } from "./dev-assistant-config";
import { McpConnectionError, type McpToolSession } from "./mcp-client";
import { MCP_DISCOVERY_TIMEOUT_MS, MCP_SESSION_TIMEOUT_MS } from "./mcp-config";

export const PROJECT_MCP_SERVER_SCRIPT = "scripts/project-mcp-server.ts";

/**
 * Подключает MCP-сервер проекта через stdio: дочерний процесс живёт одну операцию
 * и читает только рабочую копию root. Процесс стартует в каталоге приложения, где
 * лежат tsx и модель E5. Окружение — безопасный минимум SDK (PATH, HOME…):
 * ключи LLM из .env.local в дочерний процесс не передаются.
 */
export async function withProjectMcpTools<T>(
  callerSignal: AbortSignal,
  operation: (session: McpToolSession) => Promise<T>,
  root: string = process.cwd(),
  files = false,
): Promise<T> {
  callerSignal.throwIfAborted();
  const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(MCP_SESSION_TIMEOUT_MS)]);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--conditions=react-server", "--import", "tsx", PROJECT_MCP_SERVER_SCRIPT, resolve(root), ...(files ? ["--files"] : [])],
    cwd: process.cwd(),
    stderr: "inherit",
  });
  const client = new Client({ name: "flash-dev-assistant", version: "1.0.0" });

  async function request<R>(operation: () => Promise<R>): Promise<R> {
    signal.throwIfAborted();
    try {
      return await operation();
    } catch (cause) {
      if (callerSignal.aborted) throw callerSignal.reason;
      if (cause instanceof McpConnectionError) throw cause;
      throw new McpConnectionError(
        signal.aborted ? "Истекло время ожидания MCP-сервера проекта." : "Не удалось выполнить запрос к MCP-серверу проекта.",
        signal.aborted ? 504 : 502,
        { cause },
      );
    }
  }

  let result: T | undefined;
  let failed = false;
  let failure: unknown;
  try {
    const discovery = await request(async () => {
      await client.connect(transport, { signal, timeout: MCP_DISCOVERY_TIMEOUT_MS });
      const server = client.getServerVersion();
      if (!server || !client.getServerCapabilities()?.tools) {
        throw new McpConnectionError("MCP-сервер проекта не объявил поддержку инструментов.", 502);
      }
      const { tools, nextCursor } = await client.listTools(undefined, { signal, timeout: MCP_DISCOVERY_TIMEOUT_MS });
      if (nextCursor !== undefined) throw new McpConnectionError("MCP-сервер проекта вернул неожиданную пагинацию инструментов.", 502);
      return {
        server: { name: server.name, version: server.version },
        tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
        checkedAt: new Date().toISOString(),
      };
    });
    result = await operation({
      ...discovery,
      // SDK проверяет structuredContent по outputSchema из listTools.
      callTool: (name, args) => request(async () => await client.callTool(
        { name, arguments: args }, CallToolResultSchema, { signal, timeout: PROJECT_MCP_LIMITS.toolTimeoutMs },
      ) as CallToolResult),
    });
    signal.throwIfAborted();
  } catch (error) {
    failed = true;
    failure = error;
  }

  // Закрытие клиента завершает stdin и, при необходимости, дочерний процесс.
  let cleanupError: unknown;
  try { await client.close(); } catch (error) { cleanupError = error; }
  if (callerSignal.aborted) throw callerSignal.reason;
  if (failed) throw failure;
  if (cleanupError) throw new McpConnectionError("Не удалось корректно закрыть MCP-сервер проекта.", 502, { cause: cleanupError });
  return result as T;
}

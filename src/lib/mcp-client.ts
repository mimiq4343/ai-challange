import "server-only";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Dispatcher } from "undici";

import { MCP_DISCOVERY_TIMEOUT_MS, MCP_MAX_TOOL_PAGES } from "./mcp-config";
import { createMcpDispatcher, limitMcpResponse, McpValidationError, parseMcpUrl } from "./mcp-network";
import type { McpDiscoveryResult, McpTool } from "./mcp-types";

export class McpConnectionError extends Error {
  constructor(message: string, readonly status: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "McpConnectionError";
  }
}

export async function discoverMcpTools(endpoint: string): Promise<McpDiscoveryResult> {
  const url = parseMcpUrl(endpoint);
  const dispatcher = createMcpDispatcher(url);
  const signal = AbortSignal.timeout(MCP_DISCOVERY_TIMEOUT_MS);
  const transport = new StreamableHTTPClientTransport(url, {
    async fetch(input, init) {
      if (new URL(input).href !== url.href) {
        throw new McpValidationError("MCP-сервер попытался изменить адрес подключения.");
      }
      const options: RequestInit & { dispatcher: Dispatcher } = {
        ...init,
        dispatcher,
        redirect: "error",
        credentials: "omit",
        signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
      };
      return limitMcpResponse(await fetch(input, options));
    },
    reconnectionOptions: {
      maxRetries: 0,
      initialReconnectionDelay: 1_000,
      maxReconnectionDelay: 1_000,
      reconnectionDelayGrowFactor: 1,
    },
  });
  const client = new Client({ name: "flash-agent", version: "1.0.0" });
  const requestOptions = { signal, timeout: MCP_DISCOVERY_TIMEOUT_MS };
  const errors: unknown[] = [];
  let discovery: McpDiscoveryResult | undefined;

  try {
    await client.connect(transport, requestOptions);
    const server = client.getServerVersion();
    if (!server || !client.getServerCapabilities()?.tools) {
      throw new McpConnectionError("MCP-сервер не объявил поддержку инструментов.", 502);
    }
    const tools: McpTool[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor === undefined ? undefined : { cursor }, requestOptions);
      tools.push(...page.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })));
      cursor = page.nextCursor;
      if (cursor !== undefined) {
        if (cursors.has(cursor) || cursors.size >= MCP_MAX_TOOL_PAGES - 1) {
          throw new McpConnectionError("MCP-сервер не завершил выдачу списка инструментов.", 502);
        }
        cursors.add(cursor);
      }
    } while (cursor !== undefined);
    discovery = {
      server: { name: server.name, version: server.version },
      tools,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    errors.push(error);
  }

  try {
    if (transport.sessionId && !signal.aborted) await transport.terminateSession();
  } catch (error) {
    errors.push(error);
  }
  // Оба ресурса освобождаются даже при ошибке завершения удалённой сессии.
  const cleanup = await Promise.allSettled([client.close(), dispatcher.destroy()]);
  for (const result of cleanup) {
    if (result.status === "rejected") errors.push(result.reason);
  }
  if (errors.length > 0) {
    const cause = errors.length === 1 ? errors[0] : new AggregateError(errors, "MCP discovery failed");
    if (cause instanceof McpConnectionError) throw cause;
    throw new McpConnectionError(
      signal.aborted
        ? "MCP-сервер не ответил за 15 секунд."
        : "Не удалось получить инструменты MCP. Проверьте HTTPS URL, доступность сервера и поддержку Streamable HTTP без авторизации.",
      signal.aborted ? 504 : 502,
      { cause },
    );
  }
  if (!discovery) throw new McpConnectionError("MCP-сервер не вернул результат проверки.", 502);
  return discovery;
}

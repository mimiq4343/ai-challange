import "server-only";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { JsonSchemaValidator } from "@modelcontextprotocol/sdk/validation";
import type { Dispatcher } from "undici";

import { MCP_DISCOVERY_TIMEOUT_MS, MCP_MAX_RESPONSE_BYTES, MCP_MAX_TOOL_PAGES, MCP_SESSION_CLEANUP_TIMEOUT_MS, MCP_TOOL_CHAT_LIMITS } from "./mcp-config";
import { createMcpDispatcher, limitMcpResponse, McpValidationError, parseMcpUrl } from "./mcp-network";
import type { McpDiscoveryResult, McpTool } from "./mcp-types";
import { SCHEDULER_MCP_URL } from "./scheduler-config";
import { PIPELINE_LIMITS, PIPELINE_MCP_URL } from "./pipeline-config";

export class McpConnectionError extends Error {
  constructor(message: string, readonly status: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "McpConnectionError";
  }
}

export type McpToolSession = McpDiscoveryResult & {
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
};

// Discovery и выполнение используют один защищённый транспорт и одну сессию.
export async function withMcpTools<T>(
  endpoint: string,
  callerSignal: AbortSignal,
  operation: (session: McpToolSession) => Promise<T>,
  authorization?: { token: string; profileId: number },
): Promise<T> {
  callerSignal.throwIfAborted();
  const url = parseMcpUrl(endpoint);
  if (authorization && (
    (endpoint !== SCHEDULER_MCP_URL && endpoint !== PIPELINE_MCP_URL) ||
    !/^[A-Za-z0-9_-]{32,256}$/.test(authorization.token) ||
    !Number.isSafeInteger(authorization.profileId) || authorization.profileId <= 0
  )) {
    throw new McpValidationError("Учётные данные MCP допустимы только для собственного защищённого endpoint и профиля.");
  }
  const dispatcher = createMcpDispatcher(url);
  const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(MCP_TOOL_CHAT_LIMITS.timeoutMs)]);
  let terminating = false;
  const transport = new StreamableHTTPClientTransport(url, {
    ...(authorization ? {
      requestInit: { headers: {
        Authorization: `Bearer ${authorization.token}`,
        "X-Flash-Profile-Id": String(authorization.profileId),
      } },
    } : {}),
    async fetch(input, init) {
      if (new URL(input).href !== url.href) {
        throw new McpValidationError("MCP-сервер попытался изменить адрес подключения.");
      }
      const pipelineCall = url.href === PIPELINE_MCP_URL && init?.method === "POST"
        && typeof init.body === "string" && JSON.parse(init.body).method === "tools/call";
      const timeout = pipelineCall ? PIPELINE_LIMITS.toolTimeoutMs : MCP_DISCOVERY_TIMEOUT_MS;
      const options: RequestInit & { dispatcher: Dispatcher } = {
        ...init,
        dispatcher,
        redirect: "error",
        credentials: "omit",
        signal: terminating
          ? AbortSignal.timeout(MCP_SESSION_CLEANUP_TIMEOUT_MS)
          : AbortSignal.any([signal, AbortSignal.timeout(timeout), ...(init?.signal ? [init.signal] : [])]),
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
  const schemaValidator = new AjvJsonSchemaValidator();
  const client = new Client({ name: "flash-agent", version: "1.0.0" }, { jsonSchemaValidator: schemaValidator });
  const metadata = new Map<string, { taskRequired: boolean; validate?: JsonSchemaValidator<unknown> }>();
  const requestOptions = { signal, timeout: MCP_DISCOVERY_TIMEOUT_MS };
  const cleanupErrors: unknown[] = [];
  let result: T | undefined;
  let failed = false;
  let failure: unknown;

  async function request<R>(operation: () => Promise<R>): Promise<R> {
    signal.throwIfAborted();
    try {
      return await operation();
    } catch (cause) {
      if (callerSignal.aborted) throw callerSignal.reason;
      if (cause instanceof McpConnectionError) throw cause;
      throw new McpConnectionError(
        signal.aborted
          ? "Истекло время ожидания MCP-сервера."
          : "Не удалось выполнить запрос к MCP-серверу. Проверьте HTTPS URL и доступность Streamable HTTP.",
        signal.aborted ? 504 : 502,
        { cause },
      );
    }
  }

  try {
    const discovery = await request(async (): Promise<McpDiscoveryResult> => {
      await client.connect(transport, requestOptions);
      const server = client.getServerVersion();
      if (!server || !client.getServerCapabilities()?.tools) {
        throw new McpConnectionError("MCP-сервер не объявил поддержку инструментов.", 502);
      }
      const tools: McpTool[] = [];
      const cursors = new Set<string>();
      let cursor: string | undefined;
      let toolBytes = 0;
      do {
        const page = await client.listTools(cursor === undefined ? undefined : { cursor }, requestOptions);
        toolBytes += Buffer.byteLength(JSON.stringify(page.tools));
        if (toolBytes > MCP_MAX_RESPONSE_BYTES) {
          throw new McpConnectionError("Список инструментов MCP превышает допустимый размер.", 502);
        }
        tools.push(...page.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })));
        // SDK сбрасывает свой кэш на каждой странице; сохраняем полный контракт.
        for (const tool of page.tools) {
          metadata.set(tool.name, {
            taskRequired: tool.execution?.taskSupport === "required",
            validate: tool.outputSchema ? schemaValidator.getValidator(tool.outputSchema) : undefined,
          });
        }
        cursor = page.nextCursor;
        if (cursor !== undefined) {
          if (cursors.has(cursor) || cursors.size >= MCP_MAX_TOOL_PAGES - 1) {
            throw new McpConnectionError("MCP-сервер не завершил выдачу списка инструментов.", 502);
          }
          cursors.add(cursor);
        }
      } while (cursor !== undefined);
      return {
        server: { name: server.name, version: server.version },
        tools,
        checkedAt: new Date().toISOString(),
      };
    });
    result = await operation({
      ...discovery,
      callTool: (name, args) => request(async () => {
        const tool = metadata.get(name);
        if (!tool) throw new McpConnectionError("MCP-инструмент отсутствует в списке сервера.", 502);
        if (tool.taskRequired) throw new McpConnectionError("MCP-инструмент требует неподдерживаемое выполнение через tasks.", 502);
        const timeout = url.href === PIPELINE_MCP_URL ? PIPELINE_LIMITS.toolTimeoutMs : MCP_DISCOVERY_TIMEOUT_MS;
        const output = await client.callTool({ name, arguments: args }, CallToolResultSchema, { signal, timeout }) as CallToolResult;
        if (tool.validate) {
          if (!output.structuredContent && !output.isError) {
            throw new McpConnectionError("MCP-инструмент не вернул обязательный структурированный результат.", 502);
          }
          if (output.structuredContent && !tool.validate(output.structuredContent).valid) {
            throw new McpConnectionError("Результат MCP-инструмента не соответствует его схеме.", 502);
          }
        }
        return output;
      }),
    });
    signal.throwIfAborted();
  } catch (error) {
    failed = true;
    failure = error;
  }

  try {
    if (transport.sessionId) {
      terminating = true;
      await transport.terminateSession();
    }
  } catch (error) {
    cleanupErrors.push(error);
  }
  // Оба ресурса освобождаются даже при ошибке завершения удалённой сессии.
  const cleanup = await Promise.allSettled([client.close(), dispatcher.destroy()]);
  for (const outcome of cleanup) {
    if (outcome.status === "rejected") cleanupErrors.push(outcome.reason);
  }
  if (callerSignal.aborted) throw callerSignal.reason;
  // Ошибки модели/отмены не маскируются ошибкой закрытия MCP.
  if (failed) throw failure;
  if (cleanupErrors.length > 0) {
    throw new McpConnectionError("Не удалось корректно закрыть MCP-сессию.", 502, {
      cause: new AggregateError(cleanupErrors, "MCP cleanup failed"),
    });
  }
  return result as T;
}

export async function discoverMcpTools(endpoint: string): Promise<McpDiscoveryResult> {
  const signal = AbortSignal.timeout(MCP_DISCOVERY_TIMEOUT_MS);
  try {
    return await withMcpTools(endpoint, signal, async ({ server, tools, checkedAt }) => ({ server, tools, checkedAt }));
  } catch (cause) {
    if (!signal.aborted) throw cause;
    throw new McpConnectionError("MCP-сервер не ответил за 15 секунд.", 504, { cause });
  }
}

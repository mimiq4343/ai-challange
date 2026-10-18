import "server-only";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MCP_DISCOVERY_TIMEOUT_MS, MCP_SESSION_TIMEOUT_MS } from "./mcp-config";
import { McpConnectionError, type McpToolSession } from "./mcp-client";
import { PROJECT_MCP_LIMITS } from "./dev-assistant-config";

export async function withSupportMcpTools<T>(root: string, ticketId: string, callerSignal: AbortSignal, operation: (session: Pick<McpToolSession, "tools" | "callTool">) => Promise<T>): Promise<T> {
  const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(MCP_SESSION_TIMEOUT_MS)]);
  signal.throwIfAborted();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--conditions=react-server", "--import", "tsx", "scripts/support-mcp-server.ts", resolve(root), ticketId],
    cwd: process.cwd(), stderr: "inherit",
    // Окружение SDK по умолчанию не наследует ключи LLM.
  });
  const client = new Client({ name: "flash-support", version: "1.0.0" });
  async function request<R>(action: () => Promise<R>): Promise<R> {
    try { signal.throwIfAborted(); return await action(); }
    catch (cause) {
      if (callerSignal.aborted) throw callerSignal.reason;
      throw new McpConnectionError(signal.aborted ? "Истекло время ожидания MCP поддержки." : "Не удалось выполнить запрос к MCP поддержки.", signal.aborted ? 504 : 502, { cause });
    }
  }
  let result: T | undefined;
  let failed = false, failure: unknown;
  try {
    await request(() => client.connect(transport, { signal, timeout: MCP_DISCOVERY_TIMEOUT_MS }));
    const catalog = await request(() => client.listTools(undefined, { signal, timeout: MCP_DISCOVERY_TIMEOUT_MS }));
    if (client.getServerVersion()?.name !== "flash-support" || !client.getServerCapabilities()?.tools || catalog.nextCursor !== undefined) throw new McpConnectionError("Некорректный каталог MCP поддержки.", 502);
    result = await operation({ tools: catalog.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      callTool: (name, args) => request(async () => await client.callTool({ name, arguments: args }, CallToolResultSchema, { signal, timeout: PROJECT_MCP_LIMITS.toolTimeoutMs }) as CallToolResult),
    });
    signal.throwIfAborted();
  } catch (cause) { failed = true; failure = cause; }
  let cleanup: unknown;
  try { await client.close(); } catch (cause) { cleanup = cause; }
  if (callerSignal.aborted) throw callerSignal.reason;
  if (failed) throw failure;
  if (cleanup) throw new McpConnectionError("Не удалось закрыть MCP поддержки.", 502, { cause: cleanup });
  return result as T;
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

export function createDemoMcpServer(): McpServer {
  const server = new McpServer({ name: "flash-mcp", version: "1.0.0" });
  server.registerTool("add", {
    description: "Складывает два числа и возвращает сумму.",
    inputSchema: {
      a: z.number().describe("Первое число"),
      b: z.number().describe("Второе число"),
    },
    outputSchema: { sum: z.number() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, ({ a, b }) => {
    const sum = a + b;
    if (!Number.isFinite(sum)) {
      return { isError: true, content: [{ type: "text", text: "Сумма выходит за диапазон конечных чисел." }] };
    }
    return { content: [{ type: "text", text: String(sum) }], structuredContent: { sum } };
  });
  server.registerTool("get_current_time", {
    description: "Возвращает текущее время сервера в UTC, в формате ISO 8601.",
    inputSchema: {},
    outputSchema: { utc: z.string() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, () => {
    const utc = new Date().toISOString();
    return { content: [{ type: "text", text: utc }], structuredContent: { utc } };
  });
  return server;
}

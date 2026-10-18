import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { SUPPORT_CONFIG } from "./support-config";
import { requireSupportTicket, SupportDataError } from "./support-data";
import { supportSearchSchema, supportTicketSchema, supportToolSchemas, supportUserSchema, type SupportData, type SupportSearch } from "./support-types";

export function createSupportMcpServer(data: SupportData, ticketId: string, search: (query: string, limit: number, signal: AbortSignal) => Promise<SupportSearch>): McpServer {
  const selected = requireSupportTicket(data, ticketId);
  const server = new McpServer({ name: "flash-support", version: "1.0.0" });
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
  async function result(read: () => object | Promise<object>): Promise<CallToolResult> {
    try {
      const value = await read();
      return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: { ...value } };
    } catch (error) {
      if (error instanceof SupportDataError) return { isError: true, content: [{ type: "text", text: error.message }] };
      throw error;
    }
  }
  function checkUser(userId: string) {
    if (userId !== selected.userId) throw new SupportDataError("Данные недоступны в контексте выбранного пользователя.", 403);
  }
  server.registerTool("get_ticket", { description: "Описание, диагностика и история обращения текущего пользователя.", inputSchema: supportToolSchemas.get_ticket, outputSchema: z.object({ ticket: supportTicketSchema }), annotations }, ({ ticketId }) => result(() => {
    const ticket = data.tickets.find(ticket => ticket.id === ticketId && ticket.userId === selected.userId);
    if (!ticket) throw new SupportDataError("Тикет недоступен в контексте выбранного пользователя.", 404);
    return { ticket };
  }));
  server.registerTool("get_user", { description: "Карточка пользователя выбранного обращения и его окружение.", inputSchema: supportToolSchemas.get_user, outputSchema: z.object({ user: supportUserSchema }), annotations }, ({ userId }) => result(() => {
    checkUser(userId);
    const user = data.users.find(user => user.id === userId);
    if (!user) throw new SupportDataError("Пользователь не найден.", 404);
    return { user };
  }));
  server.registerTool("list_user_tickets", { description: "История обращений выбранного пользователя.", inputSchema: supportToolSchemas.list_user_tickets, outputSchema: z.object({ tickets: z.array(supportTicketSchema) }), annotations }, ({ userId }) => result(() => {
    checkUser(userId);
    return { tickets: data.tickets.filter(ticket => ticket.userId === userId) };
  }));
  server.registerTool("search_knowledge", { description: "Семантический RAG-поиск по FAQ и руководству Flash Chat. Возвращает фрагменты с ID S1… для ссылок.", inputSchema: supportToolSchemas.search_knowledge, outputSchema: supportSearchSchema, annotations }, ({ query, limit }, extra) => result(() => search(query, limit ?? SUPPORT_CONFIG.searchLimit, extra.signal)));
  return server;
}

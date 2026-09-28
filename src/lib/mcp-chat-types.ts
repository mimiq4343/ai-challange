export type McpToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError: boolean;
};

/** Сервер, на который маршрутизирован вызов; есть только в режиме оркестрации. */
export type McpToolServer = { id: string; name: string };

export type McpToolEvent =
  | { type: "tool-start"; callId: string; name: string; arguments: Record<string, unknown>; server?: McpToolServer }
  | { type: "tool-result"; callId: string; result: McpToolResult };

export type McpChatEvent =
  | McpToolEvent
  | { type: "metadata"; headers: Record<string, string> }
  | { type: "text"; delta: string }
  | { type: "done" }
  | { type: "error"; message: string };

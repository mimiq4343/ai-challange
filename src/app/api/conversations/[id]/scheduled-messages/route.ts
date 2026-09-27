import { handleMcpChat, type McpRouteContext } from "@/lib/mcp-chat-http";

export const runtime = "nodejs";

export function POST(request: Request, context: McpRouteContext) {
  return handleMcpChat(request, context, true);
}

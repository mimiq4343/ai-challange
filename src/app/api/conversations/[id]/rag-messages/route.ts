import { ragChatResponse } from "@/lib/rag-chat-http";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return ragChatResponse(request, (await context.params).id);
}

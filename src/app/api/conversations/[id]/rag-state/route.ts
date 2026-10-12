import { getConversationStore } from "@/lib/conversation-store";
import { failure } from "@/lib/rag-refinement-http";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const detail = getConversationStore().getRagChat((await context.params).id);
    if (!detail) return Response.json({ error: "Диалог не найден." }, { status: 404 });
    return Response.json(detail, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error, request, "rag_chat_state_failed"); }
}

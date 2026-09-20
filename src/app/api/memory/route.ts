import { ConversationNotFoundError, getConversationStore } from "@/lib/conversation-store";
import { getMemorySnapshot } from "@/lib/memory";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const conversationId = new URL(request.url).searchParams.get("conversationId");

  try {
    const snapshot = await getMemorySnapshot(getConversationStore(), conversationId);
    return Response.json({ snapshot });
  } catch (error) {
    if (error instanceof ConversationNotFoundError) {
      return Response.json({ error: "Диалог не найден." }, { status: 404 });
    }
    console.error("Не удалось загрузить слои памяти.", error);
    return Response.json({ error: "Не удалось загрузить слои памяти." }, { status: 500 });
  }
}

import { ConversationNotFoundError, getConversationStore } from "@/lib/conversation-store";
import { getConversationAnalytics } from "@/lib/token-analytics";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const analytics = await getConversationAnalytics(getConversationStore(), id);
    return Response.json({ analytics }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ConversationNotFoundError) {
      return Response.json({ error: "Диалог не найден." }, { status: 404 });
    }

    console.error(`Не удалось загрузить метрики диалога ${id}.`, error);
    return Response.json({ error: "Не удалось загрузить метрики диалога." }, { status: 500 });
  }
}

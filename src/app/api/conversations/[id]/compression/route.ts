import { getConversationCompressionAnalytics } from "@/lib/compression-analytics";
import {
  ConversationNotFoundError,
  getConversationStore,
} from "@/lib/conversation-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const analytics = getConversationCompressionAnalytics(
      getConversationStore(),
      id,
    );
    return Response.json(
      { analytics },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ConversationNotFoundError) {
      return Response.json({ error: "Диалог не найден." }, { status: 404 });
    }
    console.error(`Не удалось загрузить сжатие диалога ${id}.`, error);
    return Response.json({ error: "Не удалось загрузить аналитику." }, { status: 500 });
  }
}

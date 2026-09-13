import { getConversationStore } from "@/lib/conversation-store";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const store = getConversationStore();
    const conversation = store.getConversation(id);
    if (!conversation) {
      return Response.json({ error: "Диалог не найден." }, { status: 404 });
    }

    return Response.json({ conversation, messages: store.getMessages(id) });
  } catch (error) {
    console.error(`Не удалось загрузить диалог ${id}.`, error);
    return Response.json({ error: "Не удалось загрузить диалог." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    if (!getConversationStore().deleteConversation(id)) {
      return Response.json({ error: "Диалог не найден." }, { status: 404 });
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error(`Не удалось удалить диалог ${id}.`, error);
    return Response.json({ error: "Не удалось удалить диалог." }, { status: 500 });
  }
}

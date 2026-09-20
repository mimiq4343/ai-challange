import { getConversationStore } from "@/lib/conversation-store";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const entryId = Number(id);
  if (!Number.isSafeInteger(entryId) || entryId <= 0) {
    return Response.json({ error: "Некорректный id записи." }, { status: 400 });
  }

  try {
    if (!getConversationStore().deleteWorkingMemory(entryId)) {
      return Response.json({ error: "Запись не найдена." }, { status: 404 });
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error(`Не удалось удалить запись рабочей памяти ${entryId}.`, error);
    return Response.json({ error: "Не удалось удалить запись." }, { status: 500 });
  }
}

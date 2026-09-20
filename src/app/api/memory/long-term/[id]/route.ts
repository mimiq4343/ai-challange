import { getMemoryStore } from "@/lib/memory-store";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const entryId = Number(id);
  if (!Number.isSafeInteger(entryId) || entryId <= 0) {
    return Response.json({ error: "Некорректный идентификатор записи." }, { status: 400 });
  }

  if (!getMemoryStore().deleteLongTerm(entryId)) {
    return Response.json({ error: "Запись не найдена." }, { status: 404 });
  }

  return new Response(null, { status: 204 });
}

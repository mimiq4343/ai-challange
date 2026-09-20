import { getMemoryStore } from "@/lib/memory-store";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; slotId: string }> };

export async function DELETE(_request: Request, context: RouteContext) {
  const { id, slotId } = await context.params;
  const numericSlotId = Number(slotId);
  if (!Number.isSafeInteger(numericSlotId) || numericSlotId <= 0) {
    return Response.json({ error: "Некорректный идентификатор слота." }, { status: 400 });
  }

  if (!getMemoryStore().deleteSlot(id, numericSlotId)) {
    return Response.json({ error: "Слот не найден." }, { status: 404 });
  }

  return new Response(null, { status: 204 });
}

import { getConversationStore } from "@/lib/conversation-store";
import { getMemoryStore } from "@/lib/memory-store";
import type { WorkingSlotKind } from "@/lib/memory-types";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const SLOT_KINDS: Record<WorkingSlotKind, true> = {
  fact: true,
  constraint: true,
  step: true,
  open_question: true,
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!getConversationStore().getConversation(id)) {
    return Response.json({ error: "Диалог не найден." }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Некорректный JSON в теле запроса." }, { status: 400 });
  }

  const kind = body.kind;
  if (typeof kind !== "string" || !(kind in SLOT_KINDS)) {
    return Response.json(
      { error: "Поле kind должно быть fact, constraint, step или open_question." },
      { status: 400 },
    );
  }

  const value = typeof body.value === "string" ? body.value.trim() : "";
  if (value.length === 0 || value.length > 400) {
    return Response.json(
      { error: "Значение слота должно быть непустым и не длиннее 400 символов." },
      { status: 400 },
    );
  }

  const memory = getMemoryStore();
  const task = memory.getActiveTask(id);
  if (!task) {
    return Response.json(
      { error: "Сначала создайте задачу рабочей памяти." },
      { status: 409 },
    );
  }

  const slot = memory.addSlot(
    task.id,
    { kind: kind as WorkingSlotKind, value, origin: "user", reason: "добавлено вручную" },
    { conversationId: id, assistantMessageId: null },
  );
  if (!slot) {
    return Response.json({ error: "Такой слот уже есть." }, { status: 409 });
  }

  return Response.json({ slot }, { status: 201 });
}

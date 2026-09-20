import { getConversationStore } from "@/lib/conversation-store";
import { getMemoryStore } from "@/lib/memory-store";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

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

  const memory = getMemoryStore();
  if (body.action === "close") {
    const closed = memory.closeActiveTask(id);
    if (!closed) {
      return Response.json({ error: "Активной задачи нет." }, { status: 404 });
    }
    return Response.json({ task: null, closed });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length === 0 || title.length > 80) {
    return Response.json(
      { error: "Название задачи должно быть непустым и не длиннее 80 символов." },
      { status: 400 },
    );
  }

  const rawGoal = typeof body.goal === "string" ? body.goal.trim() : "";
  if (rawGoal.length > 400) {
    return Response.json({ error: "Цель длиннее 400 символов." }, { status: 400 });
  }

  return Response.json({
    task: memory.upsertActiveTask(id, { title, goal: rawGoal.length > 0 ? rawGoal : null }),
  });
}

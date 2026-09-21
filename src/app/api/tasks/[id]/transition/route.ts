import { getProfileStore } from "@/lib/profile-store";
import { isTaskStage } from "@/lib/task-machine";
import { TaskNotFoundError, getTaskStore } from "@/lib/task-store";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const runId = Number(id);
  if (!Number.isSafeInteger(runId) || runId <= 0) {
    return Response.json({ error: "Некорректный идентификатор задачи." }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Некорректный JSON в теле запроса." }, { status: 400 });
  }

  if (!isTaskStage(body.stage)) {
    return Response.json({ error: "Неизвестный этап задачи." }, { status: 400 });
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const store = getTaskStore();
  try {
    const outcome = store.transition({
      runId,
      to: body.stage,
      origin: "user",
      reason: reason.length > 0 ? reason : null,
      blockReason: reason.length > 0 ? reason : null,
    });
    if (!outcome.applied) {
      return Response.json({ error: outcome.rejectedReason }, { status: 409 });
    }
    return Response.json({ task: store.getSnapshot(getProfileStore().getActiveProfile().id) });
  } catch (error) {
    if (error instanceof TaskNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}

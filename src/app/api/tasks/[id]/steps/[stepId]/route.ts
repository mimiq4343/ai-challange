import { getProfileStore } from "@/lib/profile-store";
import { TaskNotFoundError, getTaskStore } from "@/lib/task-store";
import type { TaskStepStatus } from "@/lib/task-types";

export const runtime = "nodejs";

const STEP_STATUSES: Record<TaskStepStatus, true> = {
  pending: true,
  active: true,
  done: true,
  skipped: true,
};

type RouteContext = { params: Promise<{ id: string; stepId: string }> };

function parseIds(id: string, stepId: string): { runId: number; stepId: number } | null {
  const runId = Number(id);
  const numericStepId = Number(stepId);
  if (
    !Number.isSafeInteger(runId) ||
    runId <= 0 ||
    !Number.isSafeInteger(numericStepId) ||
    numericStepId <= 0
  ) {
    return null;
  }
  return { runId, stepId: numericStepId };
}

export async function PATCH(request: Request, context: RouteContext) {
  const params = await context.params;
  const ids = parseIds(params.id, params.stepId);
  if (!ids) return Response.json({ error: "Некорректный идентификатор." }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Некорректный JSON в теле запроса." }, { status: 400 });
  }

  const status = body.status;
  if (typeof status !== "string" || !(status in STEP_STATUSES)) {
    return Response.json({ error: "Неизвестный статус шага." }, { status: 400 });
  }

  const result = typeof body.result === "string" ? body.result.trim() : "";
  const store = getTaskStore();
  try {
    store.updateStep({
      runId: ids.runId,
      stepId: ids.stepId,
      status: status as TaskStepStatus,
      result: result.length > 0 ? result : null,
      origin: "user",
    });
    return Response.json({ task: store.getSnapshot(getProfileStore().getActiveProfile().id) });
  } catch (error) {
    if (error instanceof TaskNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const params = await context.params;
  const ids = parseIds(params.id, params.stepId);
  if (!ids) return Response.json({ error: "Некорректный идентификатор." }, { status: 400 });

  const store = getTaskStore();
  if (!store.deleteStep(ids.runId, ids.stepId)) {
    return Response.json({ error: "Шаг не найден." }, { status: 404 });
  }
  return Response.json({ task: store.getSnapshot(getProfileStore().getActiveProfile().id) });
}

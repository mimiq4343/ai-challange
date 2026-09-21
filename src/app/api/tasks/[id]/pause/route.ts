import { getProfileStore } from "@/lib/profile-store";
import {
  TaskNotFoundError,
  TaskTransitionError,
  getTaskStore,
} from "@/lib/task-store";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const runId = Number(id);
  if (!Number.isSafeInteger(runId) || runId <= 0) {
    return Response.json({ error: "Некорректный идентификатор задачи." }, { status: 400 });
  }

  const store = getTaskStore();
  try {
    store.setPaused(runId, true);
    return Response.json({ task: store.getSnapshot(getProfileStore().getActiveProfile().id) });
  } catch (error) {
    if (error instanceof TaskNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof TaskTransitionError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}

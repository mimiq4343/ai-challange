import { getProfileStore } from "@/lib/profile-store";
import { TaskNotFoundError, getTaskStore } from "@/lib/task-store";

export const runtime = "nodejs";

const MAX_STEP_LENGTH = 200;

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

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length === 0 || title.length > MAX_STEP_LENGTH) {
    return Response.json(
      { error: `Шаг: от 1 до ${MAX_STEP_LENGTH} символов.` },
      { status: 400 },
    );
  }

  const store = getTaskStore();
  try {
    store.addStep(runId, title);
    return Response.json(
      { task: store.getSnapshot(getProfileStore().getActiveProfile().id) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof TaskNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}

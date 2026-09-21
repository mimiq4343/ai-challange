import { getProfileStore } from "@/lib/profile-store";
import { getTaskStore } from "@/lib/task-store";

export const runtime = "nodejs";

const MAX_TITLE_LENGTH = 120;
const MAX_GOAL_LENGTH = 400;

export async function GET() {
  const profile = getProfileStore().getActiveProfile();
  return Response.json({ task: getTaskStore().getSnapshot(profile.id) });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Некорректный JSON в теле запроса." }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length === 0 || title.length > MAX_TITLE_LENGTH) {
    return Response.json(
      { error: `Название задачи: от 1 до ${MAX_TITLE_LENGTH} символов.` },
      { status: 400 },
    );
  }

  const rawGoal = typeof body.goal === "string" ? body.goal.trim() : "";
  if (rawGoal.length > MAX_GOAL_LENGTH) {
    return Response.json({ error: "Цель длиннее 400 символов." }, { status: 400 });
  }

  const profile = getProfileStore().getActiveProfile();
  const store = getTaskStore();
  if (store.getLiveRun(profile.id)) {
    return Response.json(
      { error: "У профиля уже есть незавершённая задача." },
      { status: 409 },
    );
  }

  store.createRun(profile.id, title, rawGoal.length > 0 ? rawGoal : null);
  return Response.json({ task: store.getSnapshot(profile.id) }, { status: 201 });
}

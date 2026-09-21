import { getProfileStore } from "@/lib/profile-store";
import { getTaskStore } from "@/lib/task-store";

export const runtime = "nodejs";

/** Подтверждение предложения агента: задача заводится на этапе планирования. */
export async function POST() {
  const profile = getProfileStore().getActiveProfile();
  const store = getTaskStore();
  if (store.getLiveRun(profile.id)) {
    return Response.json(
      { error: "У профиля уже есть незавершённая задача." },
      { status: 409 },
    );
  }
  if (!store.acceptProposal(profile.id)) {
    return Response.json({ error: "Предложения задачи нет." }, { status: 404 });
  }

  return Response.json({
    task: store.getSnapshot(profile.id),
    proposal: null,
  });
}

export async function DELETE() {
  const profile = getProfileStore().getActiveProfile();
  const store = getTaskStore();
  if (!store.discardProposal(profile.id)) {
    return Response.json({ error: "Предложения задачи нет." }, { status: 404 });
  }

  return Response.json({ task: store.getSnapshot(profile.id), proposal: null });
}

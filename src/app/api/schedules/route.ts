import { getProfileStore } from "@/lib/profile-store";
import { SCHEDULER_LIMITS } from "@/lib/scheduler-config";
import { getSchedulerStore } from "@/lib/scheduler-store";
import type { SchedulerSnapshot } from "@/lib/scheduler-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (new URL(request.url).searchParams.size > 0) {
    return Response.json({ error: "Список расписаний не принимает параметры запроса." }, { status: 400, headers });
  }
  const profile = getProfileStore().getActiveProfile();
  const store = getSchedulerStore();
  const snapshot: SchedulerSnapshot = {
    jobs: store.list(profile.id),
    runs: store.listRuns(profile.id, undefined, SCHEDULER_LIMITS.feedLimit),
  };
  return Response.json(snapshot, {
    headers: { ...headers, "X-Flash-Profile-Id": String(profile.id) },
  });
}

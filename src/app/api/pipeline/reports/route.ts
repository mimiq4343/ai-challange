import { getPipelineStore } from "@/lib/pipeline-store";
import { getProfileStore } from "@/lib/profile-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (new URL(request.url).searchParams.size > 0) {
    return Response.json({ error: "Список отчётов не принимает параметры запроса." }, { status: 400, headers });
  }
  const profile = getProfileStore().getActiveProfile();
  return Response.json({ reports: getPipelineStore().listReports(profile.id) }, {
    headers: { ...headers, "X-Flash-Profile-Id": String(profile.id) },
  });
}

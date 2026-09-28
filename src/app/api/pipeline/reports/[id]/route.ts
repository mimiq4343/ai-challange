import { pipelineReportResponse } from "@/lib/pipeline-http";
import { getProfileStore } from "@/lib/profile-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return pipelineReportResponse(getProfileStore().getActiveProfile().id, id);
}

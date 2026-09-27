import * as z from "zod/v4";

import { readMcpObjectBody, validateMcpMutation } from "@/lib/mcp-api";
import { getProfileStore } from "@/lib/profile-store";
import { getSchedulerStore, SchedulerValidationError } from "@/lib/scheduler-store";

export const runtime = "nodejs";

const jobIdSchema = z.uuid();
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const rejected = validateMcpMutation(request);
  if (rejected) return rejected;
  const parsedId = jobIdSchema.safeParse((await context.params).id);
  if (!parsedId.success || new URL(request.url).searchParams.size > 0) {
    return Response.json({ error: "Некорректный идентификатор или параметры расписания." }, { status: 400 });
  }
  const body = await readMcpObjectBody(request);
  if (body instanceof Response) return body;
  if (Object.keys(body).length !== 0) {
    return Response.json({ error: "Остановка принимает только пустой JSON-объект {}." }, { status: 400 });
  }
  const profile = getProfileStore().getActiveProfile();
  const headers = { "Cache-Control": "no-store", "X-Flash-Profile-Id": String(profile.id) };
  try {
    const job = getSchedulerStore().stop(profile.id, parsedId.data);
    if (!job) return Response.json({ error: "Расписание не найдено." }, { status: 404, headers });
    return Response.json({ job }, { headers });
  } catch (error) {
    if (error instanceof SchedulerValidationError) {
      return Response.json({ error: error.message }, { status: 400, headers });
    }
    throw error;
  }
}

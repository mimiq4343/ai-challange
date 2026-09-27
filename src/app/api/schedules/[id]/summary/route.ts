import * as z from "zod/v4";

import { getProfileStore } from "@/lib/profile-store";
import { SCHEDULER_LIMITS } from "@/lib/scheduler-config";
import { getSchedulerStore, SchedulerValidationError } from "@/lib/scheduler-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const jobIdSchema = z.uuid();
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  const parsedId = jobIdSchema.safeParse((await context.params).id);
  if (!parsedId.success) {
    return Response.json({ error: "Некорректный идентификатор расписания." }, { status: 400, headers });
  }
  const query = new URL(request.url).searchParams;
  const rawPeriod = query.get("periodHours");
  const periodHours = rawPeriod === null ? SCHEDULER_LIMITS.defaultPeriodHours : Number(rawPeriod);
  if (
    [...query.keys()].some((key) => key !== "periodHours") ||
    query.getAll("periodHours").length > 1 ||
    (rawPeriod !== null && !/^[1-9]\d*$/.test(rawPeriod)) ||
    !Number.isSafeInteger(periodHours) || periodHours < 1 || periodHours > SCHEDULER_LIMITS.maxPeriodHours
  ) {
    return Response.json({ error: `Укажите только periodHours: целое число от 1 до ${SCHEDULER_LIMITS.maxPeriodHours}.` }, { status: 400, headers });
  }
  const profile = getProfileStore().getActiveProfile();
  headers["X-Flash-Profile-Id"] = String(profile.id);
  try {
    const aggregate = getSchedulerStore().getSummary(profile.id, parsedId.data, periodHours);
    if (!aggregate) return Response.json({ error: "Расписание не найдено." }, { status: 404, headers });
    return Response.json(aggregate, { headers });
  } catch (error) {
    if (error instanceof SchedulerValidationError) {
      return Response.json({ error: error.message }, { status: 400, headers });
    }
    throw error;
  }
}

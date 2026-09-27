import * as z from "zod/v4";
import { githubRepositoryInputSchema } from "./github-repository-tool";
import { SCHEDULER_LIMITS } from "./scheduler-config";

export const schedulerToolSchemas = {
  create_repository_schedule: z.strictObject({
    ...githubRepositoryInputSchema,
    intervalMinutes: z.number().int().min(SCHEDULER_LIMITS.minIntervalMinutes)
      .max(SCHEDULER_LIMITS.maxIntervalMinutes)
      .describe("Интервал сбора в минутах, от 15 до 10080. Час = 60 минут. Первый сбор сразу после создания."),
  }),
  list_repository_schedules: z.strictObject({}),
  stop_repository_schedule: z.strictObject({
    jobId: z.uuid().describe("Идентификатор задания из списка расписаний"),
  }),
  get_repository_summary: z.strictObject({
    jobId: z.uuid().describe("Идентификатор задания из списка расписаний"),
    periodHours: z.number().int().min(1).max(SCHEDULER_LIMITS.maxPeriodHours).optional()
      .describe("Период сводки в часах, от 1 до 720; без параметра — последние 24 часа"),
  }),
};

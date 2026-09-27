import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { schedulerToolSchemas } from "./scheduler-tool-schemas";
import { getSchedulerStore, type SqliteSchedulerStore } from "./scheduler-store";
import type { ScheduleJob } from "./scheduler-types";

// Профиль задаётся аутентифицированным HTTP-контекстом, не аргументами модели.
function publicJob(job: ScheduleJob) {
  const { profileId: _profileId, ...data } = job;
  void _profileId;
  return data;
}

function result(data: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }], structuredContent: data };
}

export function createSchedulerMcpServer(
  profileId: number,
  store: SqliteSchedulerStore = getSchedulerStore(),
): McpServer {
  const server = new McpServer({ name: "flash-scheduler", version: "1.0.0" });
  server.registerTool("create_repository_schedule", {
    description: "Создаёт постоянное расписание мониторинга публичного GitHub-репозитория. Первый сбор выполняется в фоне сразу, следующие — через intervalMinutes. Работает при закрытом браузере. Повтор с теми же параметрами возвращает активное задание. Создание сохраняется даже при отмене ответа чата.",
    inputSchema: schedulerToolSchemas.create_repository_schedule,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, (input) => result({ job: publicJob(store.create(profileId, schedulerToolSchemas.create_repository_schedule.parse(input))) }));
  server.registerTool("list_repository_schedules", {
    description: "Возвращает сохранённые активные и остановленные расписания текущего профиля, их идентификаторы и время следующего запуска.",
    inputSchema: schedulerToolSchemas.list_repository_schedules,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, () => result({ jobs: store.list(profileId).map(publicJob) }));
  server.registerTool("stop_repository_schedule", {
    description: "Останавливает задание текущего профиля. Новых запусков не будет; сохранённые измерения и сводки остаются доступны. Остановка сохраняется даже при отмене ответа чата.",
    inputSchema: schedulerToolSchemas.stop_repository_schedule,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, (input) => {
    const { jobId } = schedulerToolSchemas.stop_repository_schedule.parse(input);
    const job = store.stop(profileId, jobId);
    if (!job) throw new Error("Задание не найдено в текущем профиле.");
    return result({ job: publicJob(job) });
  });
  server.registerTool("get_repository_summary", {
    description: "Возвращает агрегированные сохранённые измерения задания за последние periodHours (по умолчанию 24): первый и последний замеры, изменение звёзд и форков, число замеров и ошибок. Не обращается к GitHub заново. При менее чем двух замерах изменение неизвестно, а не равно нулю.",
    inputSchema: schedulerToolSchemas.get_repository_summary,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, (input) => {
    const { jobId, periodHours } = schedulerToolSchemas.get_repository_summary.parse(input);
    const aggregate = store.getSummary(profileId, jobId, periodHours);
    if (!aggregate) throw new Error("Задание не найдено в текущем профиле.");
    return result({ ...aggregate, job: publicJob(aggregate.job) });
  });
  return server;
}

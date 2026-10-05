import { MCP_PUBLIC_URL } from "./mcp-config";
import { PIPELINE_MCP_URL } from "./pipeline-config";
import { SCHEDULER_MCP_URL } from "./scheduler-config";

export const DEEPWIKI_MCP_URL = "https://mcp.deepwiki.com/mcp";

export type OrchestrationServerId = "flash" | "pipeline" | "deepwiki" | "scheduler";
export type OrchestrationServerAuth = "none" | "scheduler" | "pipeline";

export type OrchestrationServer = {
  id: OrchestrationServerId;
  name: string;
  url: string;
  auth: OrchestrationServerAuth;
  role: string;
};

// Реестр версионируется с кодом: серверы из интерфейса Day 16 сюда не попадают,
// а разрешённые инструменты задаёт orchestration-tools.ts.
export const ORCHESTRATION_SERVERS: readonly OrchestrationServer[] = [
  { id: "pipeline", name: "Flash Pipeline", url: PIPELINE_MCP_URL, auth: "pipeline", role: "Поиск репозиториев GitHub, обзор и сохранение Markdown-отчёта" },
  { id: "flash", name: "Flash GitHub", url: MCP_PUBLIC_URL, auth: "none", role: "Актуальные метаданные одного репозитория GitHub" },
  { id: "deepwiki", name: "DeepWiki", url: DEEPWIKI_MCP_URL, auth: "none", role: "Внешний сервер: ответы об устройстве кода по DeepWiki" },
  { id: "scheduler", name: "Flash Scheduler", url: SCHEDULER_MCP_URL, auth: "scheduler", role: "Периодический мониторинг репозиториев и сводки" },
];

// Разделитель не встречается в id серверов, поэтому имя разбирается однозначно.
export const ORCHESTRATION_TOOL_SEPARATOR = "__";

export const ORCHESTRATION_LIMITS = {
  timeoutMs: 300_000,
  // Десять раундов с вызовами и отдельный последний раунд без инструментов для итога.
  maxRounds: 11,
  maxToolCalls: 10,
  maxToolsPerRound: 3,
  // Каталог из четырёх серверов крупнее одиночного набора инструментов.
  maxToolDefinitionBytes: 32 * 1024,
  // Ответ DeepWiki на вопрос о коде занимает 10–20 секунд.
  deepWikiToolTimeoutMs: 60_000,
  deepWikiQuestionMaxChars: 500,
  deepWikiMaxRepositories: 5,
  runRetention: 20,
  requestPreviewChars: 500,
} as const;

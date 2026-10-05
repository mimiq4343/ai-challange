import * as z from "zod/v4";
import { githubRepositoryInputSchema } from "./github-repository-tool";
import {
  ORCHESTRATION_LIMITS, ORCHESTRATION_SERVERS, ORCHESTRATION_TOOL_SEPARATOR,
  type OrchestrationServerId,
} from "./orchestration-config";
import { pipelineToolSchemas } from "./pipeline-tool-schemas";
import { schedulerToolSchemas } from "./scheduler-tool-schemas";

type ToolSchema = z.ZodType<Record<string, unknown>>;

const repositoryName = z.string().max(140)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9_.-]+$/, "Ожидается owner/repo без URL")
  .refine((value) => !/\/\.{1,2}$/.test(value), "Недопустимое имя репозитория");

// Аргументы внешнего сервера проверяются нашей схемой до отправки: модель не может
// переслать туда произвольные поля, даже если их допускает удалённая схема.
const deepWikiToolSchemas = {
  ask_wiki_question: z.strictObject({
    repoName: z.union([
      repositoryName,
      z.array(repositoryName).min(1).max(ORCHESTRATION_LIMITS.deepWikiMaxRepositories),
    ]).describe("Публичный репозиторий GitHub owner/repo или список до пяти таких репозиториев"),
    question: z.string().trim().min(1).max(ORCHESTRATION_LIMITS.deepWikiQuestionMaxChars)
      .regex(/^[^\p{Cc}]+$/u, "Вопрос не должен содержать управляющие символы")
      .describe("Вопрос об устройстве кода или документации репозитория"),
  }),
  read_wiki_structure: z.strictObject({
    repoName: repositoryName.describe("Публичный репозиторий GitHub owner/repo"),
  }),
};

// Разрешённые инструменты каждого сервера. Всё остальное, что объявит сервер,
// модель не видит; read_wiki_contents исключён, потому что возвращает всю wiki.
const ALLOWED_TOOLS: Record<OrchestrationServerId, Record<string, ToolSchema>> = {
  pipeline: pipelineToolSchemas,
  flash: { get_repository_info: z.strictObject(githubRepositoryInputSchema) },
  deepwiki: deepWikiToolSchemas,
  scheduler: schedulerToolSchemas,
};

export function orchestrationToolName(serverId: OrchestrationServerId, tool: string): string {
  return `${serverId}${ORCHESTRATION_TOOL_SEPARATOR}${tool}`;
}

export function parseOrchestrationToolName(name: string): { serverId: OrchestrationServerId; tool: string } | null {
  const separator = name.indexOf(ORCHESTRATION_TOOL_SEPARATOR);
  if (separator <= 0) return null;
  const server = ORCHESTRATION_SERVERS.find(({ id }) => id === name.slice(0, separator));
  const tool = name.slice(separator + ORCHESTRATION_TOOL_SEPARATOR.length);
  return server && tool ? { serverId: server.id, tool } : null;
}

export function allowedOrchestrationTools(serverId: OrchestrationServerId): string[] {
  return Object.keys(ALLOWED_TOOLS[serverId]);
}

export const orchestrationToolSchemas: Record<string, ToolSchema> = Object.fromEntries(
  ORCHESTRATION_SERVERS.flatMap(({ id }) => Object.entries(ALLOWED_TOOLS[id])
    .map(([tool, schema]) => [orchestrationToolName(id, tool), schema])),
);

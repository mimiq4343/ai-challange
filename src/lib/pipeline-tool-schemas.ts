import * as z from "zod/v4";
import { githubRepositoryOutputSchema } from "./github-repository-tool";
import { PIPELINE_LIMITS } from "./pipeline-config";

export const pipelineToolSchemas = {
  search_repositories: z.strictObject({
    query: z.string().trim().min(1).max(PIPELINE_LIMITS.queryMaxChars)
      .regex(/^[^\p{Cc}]+$/u, "Поисковый запрос не должен содержать управляющие символы")
      .describe("Поисковый запрос GitHub для публичных репозиториев: ключевые слова и допустимые квалификаторы"),
  }),
  summarize_repositories: z.strictObject({
    searchResultId: z.uuid().describe("Идентификатор сохранённого результата search_repositories этого профиля"),
  }),
  save_to_file: z.strictObject({
    summaryId: z.uuid().describe("Идентификатор завершённой сводки summarize_repositories этого профиля"),
  }),
};

export const pipelineRepositoriesSchema = z.array(z.strictObject({
  ...githubRepositoryOutputSchema,
  fullName: githubRepositoryOutputSchema.fullName.max(140),
  description: z.string().max(500).nullable(),
  language: z.string().max(100).nullable(),
  url: githubRepositoryOutputSchema.url.max(256),
})).max(PIPELINE_LIMITS.maxRepositories);

// Учитываем обе копии результата MCP, включая JSON-экранирование строк.
export function pipelineToolResult<T extends object>(data: T) {
  const result = { content: [{ type: "text" as const, text: JSON.stringify(data) }], structuredContent: { ...data } };
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > PIPELINE_LIMITS.toolResultMaxBytes) {
    throw new Error("Результат pipeline превышает допустимый размер ответа MCP.");
  }
  return result;
}

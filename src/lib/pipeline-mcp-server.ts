import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fetchPipelineRepositories } from "./pipeline-search";
import { getPipelineStore, PipelineNotFoundError, type SqlitePipelineStore } from "./pipeline-store";
import { createPipelineSummarizer, type PipelineSummarizer } from "./pipeline-summary";
import { pipelineToolResult, pipelineToolSchemas } from "./pipeline-tool-schemas";

type PipelineDependencies = {
  search?: typeof fetchPipelineRepositories;
  summarize?: PipelineSummarizer;
};

// Профиль поступает только из доверенного HTTP-контекста, не из аргументов модели.
export function createPipelineMcpServer(
  profileId: number,
  store: SqlitePipelineStore = getPipelineStore(),
  dependencies: PipelineDependencies = {},
): McpServer {
  const server = new McpServer({ name: "flash-pipeline", version: "1.0.0" });
  server.registerTool("search_repositories", {
    description: "Шаг 1: ищет до пяти публичных репозиториев через GitHub Search API, сохраняет неизменяемый снимок метаданных и возвращает searchResultId. Пустой список означает отсутствие совпадений. Ошибка или лимит GitHub — ошибка, не пустой результат. Не читает код или README.",
    inputSchema: pipelineToolSchemas.search_repositories,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (input, extra) => {
    const { query } = pipelineToolSchemas.search_repositories.parse(input);
    const repositories = await (dependencies.search ?? fetchPipelineRepositories)(query, extra.signal);
    extra.signal.throwIfAborted();
    return pipelineToolResult(store.saveSearch(profileId, query, repositories));
  });
  server.registerTool("summarize_repositories", {
    description: "Шаг 2: принимает только searchResultId из текущего поиска, читает сохранённый снимок текущего профиля и вызывает DeepSeek для законченного Markdown-отчёта. Возвращает summaryId и точный Markdown только после полного успешного ответа. Не запускает поиск повторно и не создаёт файл.",
    inputSchema: pipelineToolSchemas.summarize_repositories,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (input, extra) => {
    const { searchResultId } = pipelineToolSchemas.summarize_repositories.parse(input);
    const search = store.getSearch(profileId, searchResultId);
    if (!search) throw new PipelineNotFoundError();
    extra.signal.throwIfAborted();
    const markdown = await (dependencies.summarize ?? createPipelineSummarizer())(search, extra.signal);
    extra.signal.throwIfAborted();
    return pipelineToolResult(store.saveSummary(profileId, searchResultId, markdown));
  });
  server.registerTool("save_to_file", {
    description: "Шаг 3: принимает только summaryId завершённой сводки текущего профиля, сохраняет её точные UTF-8 байты в Markdown-файл с серверным именем и возвращает downloadUrl. Не принимает текст или путь от модели. Повтор возвращает тот же проверенный файл. Завершённое сохранение остаётся при отмене чата.",
    inputSchema: pipelineToolSchemas.save_to_file,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, (input, extra) => {
    const { summaryId } = pipelineToolSchemas.save_to_file.parse(input);
    extra.signal.throwIfAborted();
    return pipelineToolResult(store.saveReport(profileId, summaryId));
  });
  return server;
}

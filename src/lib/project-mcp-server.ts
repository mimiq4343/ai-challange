import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PROJECT_MCP_LIMITS as LIMITS } from "./dev-assistant-config";
import type { DocumentEmbeddingClient } from "./document-embeddings";
import { createDocsSearch, ProjectDocsError } from "./project-docs";
import { listTrackedEntries, ProjectGitError, readGitBranch, readGitDiff, readGitStatus } from "./project-git";
import { normalizeProjectPath, projectToolOutputSchemas as outputs, projectToolSchemas as inputs } from "./project-tool-schemas";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

async function toolResult(read: () => Promise<object>): Promise<CallToolResult> {
  try {
    const data = await read();
    return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: { ...data } };
  } catch (error) {
    // Ожидаемые ошибки git и индекса — результат шага для модели; остальное пробрасывает SDK.
    if (error instanceof ProjectGitError || error instanceof ProjectDocsError) {
      return { isError: true, content: [{ type: "text", text: error.message }] };
    }
    throw error;
  }
}

export function createProjectMcpServer(root: string, embedder: Pick<DocumentEmbeddingClient, "embed">): McpServer {
  const server = new McpServer({ name: "flash-project", version: "1.0.0" });
  const searchDocs = createDocsSearch(root, embedder);
  server.registerTool("search_docs", {
    description: "Семантический поиск по документации проекта: README.md, AGENTS.md, docs/ и SQL-схемам src/lib/*-schema.ts. Возвращает фрагменты с id S1, S2, … для ссылок.",
    inputSchema: inputs.search_docs,
    outputSchema: outputs.search_docs,
    annotations: READ_ONLY,
  }, ({ query, limit }, extra) => toolResult(() => searchDocs(query, limit ?? LIMITS.defaultSearchK, extra.signal)));
  server.registerTool("git_branch", {
    description: "Текущая git-ветка проекта, HEAD, upstream с расхождением и последний коммит.",
    inputSchema: inputs.git_branch,
    outputSchema: outputs.git_branch,
    annotations: READ_ONLY,
  }, (_args, extra) => toolResult(() => readGitBranch(root, extra.signal)));
  server.registerTool("git_status", {
    description: "Изменённые, переименованные, конфликтные и неотслеживаемые файлы рабочего дерева.",
    inputSchema: inputs.git_status,
    outputSchema: outputs.git_status,
    annotations: READ_ONLY,
  }, (_args, extra) => toolResult(() => readGitStatus(root, extra.signal)));
  server.registerTool("list_files", {
    description: "Содержимое каталога среди отслеживаемых git файлов: подкаталоги с числом файлов и файлы. Без path — корень репозитория. Для игнорируемого или неотслеживаемого пути возвращает status ignored/untracked без содержимого.",
    inputSchema: inputs.list_files,
    outputSchema: outputs.list_files,
    annotations: READ_ONLY,
  }, ({ path }, extra) => toolResult(() => listTrackedEntries(root, normalizeProjectPath(path), extra.signal)));
  server.registerTool("git_diff", {
    description: `Diff рабочего дерева и индекса относительно HEAD, со сводкой --stat; патч обрезается до ${LIMITS.maxDiffCharacters} символов. Неотслеживаемые файлы не входят.`,
    inputSchema: inputs.git_diff,
    outputSchema: outputs.git_diff,
    annotations: READ_ONLY,
  }, ({ path }, extra) => toolResult(() => readGitDiff(root, normalizeProjectPath(path), extra.signal)));
  return server;
}

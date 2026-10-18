import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ProjectFiles } from "./file-assistant-files";
import { FileAssistantError, fileToolSchemas } from "./file-assistant-types";

export function registerFileAssistantTools(server: McpServer, root: string): void {
  const files = new ProjectFiles(root);
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const result = (operation: () => object): CallToolResult => {
    try {
      const output = operation();
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: { ...output } };
    } catch (cause) {
      if (cause instanceof FileAssistantError) return { isError: true, content: [{ type: "text", text: cause.message }] };
      throw cause;
    }
  };
  server.registerTool("read_file", {
    description: "Читает текущий UTF-8 файл проекта с номерами диапазона строк и SHA-256 всего файла. Ограниченные результаты помечены truncated. Секреты, базы и символические ссылки недоступны.",
    inputSchema: fileToolSchemas.read_file, annotations: readOnly,
  }, ({ path, startLine, endLine }) => result(() => files.read(path, startLine, endLine)));
  server.registerTool("search_files", {
    description: "Буквальный поиск подстроки сразу по исходникам и документации текущего проекта, включая новые неигнорируемые файлы. Возвращает пути, строки, пропуски и признак неполного поиска. path ограничивает каталог или файл.",
    inputSchema: fileToolSchemas.search_files, annotations: readOnly,
  }, ({ query, path }) => result(() => files.search(query, path)));
  server.registerTool("propose_file", {
    description: "Подготавливает сохраняемое предложение и diff для README.md или docs/*.md без записи в целевой файл. Для нового файла: baseHash=null и content. Для обновления: hash из read_file и edits с однозначными oldText/newText, либо полное content. Применяет только пользователь кнопкой.",
    inputSchema: fileToolSchemas.propose_file,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, ({ path, baseHash, content, edits }) => result(() => files.propose(path, baseHash, content ?? edits!)));
}

import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LocalDocumentEmbeddingClient } from "../src/lib/local-document-embeddings";
import { createProjectMcpServer } from "../src/lib/project-mcp-server";
import { RAG_EMBEDDING_CONFIG } from "../src/lib/rag-embedding-config";

// Аргумент — корень рабочей копии; модель E5 берётся из каталога приложения (cwd).
// stdout занят JSON-RPC, диагностика идёт только в stderr.
const root = process.argv[2];
if (!root) {
  console.error("Использование: project-mcp-server.ts <корень репозитория>");
  process.exit(2);
}
const embedder = new LocalDocumentEmbeddingClient(resolve(RAG_EMBEDDING_CONFIG.modelPath));
createProjectMcpServer(resolve(root), embedder).connect(new StdioServerTransport()).catch((error: unknown) => {
  console.error("project_mcp_failed", error instanceof Error ? error.message : "UnknownError");
  process.exitCode = 1;
});

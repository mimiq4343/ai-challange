import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LocalDocumentEmbeddingClient } from "../src/lib/local-document-embeddings";
import { SUPPORT_INDEX_CONFIG } from "../src/lib/support-config";
import { loadSupportData } from "../src/lib/support-data";
import { createKnowledgeSearch } from "../src/lib/support-knowledge";
import { createSupportMcpServer } from "../src/lib/support-mcp-server";

async function main() {
  const [root, ticketId] = process.argv.slice(2);
  if (!root || !ticketId) throw new Error("Использование: support-mcp-server.ts <корень проекта> <ticketId>");
  const data = await loadSupportData(root);
  const embedder = new LocalDocumentEmbeddingClient(resolve(SUPPORT_INDEX_CONFIG.modelPath));
  await createSupportMcpServer(data, ticketId, createKnowledgeSearch(root, embedder)).connect(new StdioServerTransport());
}
// stdout занят JSON-RPC. Диагностика не содержит данные запросов и секреты.
main().catch((cause: unknown) => { console.error("support_mcp_failed", { error: cause instanceof Error ? cause.name : "UnknownError" }); process.exitCode = 1; });

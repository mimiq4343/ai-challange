import { resolve } from "node:path";
import { SUPPORT_CONFIG, SUPPORT_INDEX_CONFIG as CONFIG } from "../src/lib/support-config";
import { indexDocuments } from "../src/lib/document-indexer";
import { SqliteDocumentStore } from "../src/lib/document-store";
import { LocalDocumentEmbeddingClient } from "../src/lib/local-document-embeddings";
import { prepareRagModel } from "../src/lib/rag-model-download";

async function main() {
  const root = process.cwd();
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("Индексация поддержки прервана."));
  process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
  try {
    await prepareRagModel(root, controller.signal, console.log);
    const client = new LocalDocumentEmbeddingClient(resolve(root, CONFIG.modelPath));
    const store = new SqliteDocumentStore(resolve(root, CONFIG.databasePath), CONFIG);
    try {
      await indexDocuments({ root, store, client, config: CONFIG, sources: SUPPORT_CONFIG.sources,
        questions: [
          { id: "mcp", question: "Почему защищённый инструмент MCP возвращает 403?", source: "docs/support/troubleshooting.md", section: "Авторизация MCP: 401, 403 и доступ к инструментам", evidence: "HTTP 403 сам по себе не доказывает" },
          { id: "history", question: "Почему остановленный ответ исчез после обновления?", source: "docs/support/faq.md", section: "Сохранение истории и остановленный ответ", evidence: "этот обмен не сохраняется" },
          { id: "index", question: "Почему новая инструкция не находится в базе знаний?", source: "docs/support/troubleshooting.md", section: "В документах есть ответ, но RAG его не находит", evidence: "индекс после его последнего изменения" },
        ], countTokens: text => client.countTokens(text), signal: controller.signal, onProgress: console.log });
    } finally { store.close(); }
  } finally { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); }
}
main().catch((cause: unknown) => { console.error(cause instanceof Error ? cause.message : "Не удалось создать индекс поддержки."); process.exitCode = 1; });

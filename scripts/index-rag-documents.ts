import { resolve } from "node:path";
import { indexDocuments } from "../src/lib/document-indexer";
import { SqliteDocumentStore } from "../src/lib/document-store";
import { LocalDocumentEmbeddingClient } from "../src/lib/local-document-embeddings";
import { RAG_EMBEDDING_CONFIG } from "../src/lib/rag-embedding-config";
import { prepareRagModel } from "../src/lib/rag-model-download";

async function main(): Promise<void> {
  const root = process.cwd();
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("Индексация прервана пользователем."));
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    await prepareRagModel(root, controller.signal, console.log);
    const client = new LocalDocumentEmbeddingClient(resolve(root, RAG_EMBEDDING_CONFIG.modelPath));
    const store = new SqliteDocumentStore(resolve(root, RAG_EMBEDDING_CONFIG.databasePath), RAG_EMBEDDING_CONFIG);
    try {
      const report = await indexDocuments({ root, store, client, config: RAG_EMBEDDING_CONFIG,
        countTokens: (text) => client.countTokens(text), signal: controller.signal, onProgress: console.log });
      console.log(`Модель: ${report.model}; размерность: ${report.dimensions}; SQLite: ${RAG_EMBEDDING_CONFIG.databasePath}`);
      for (const item of report.comparison) console.log(`${item.strategy}: ${item.chunks} чанков; HitRate@5 ${(item.hitRateAt5 * 100).toFixed(1)}%.`);
    } finally { store.close(); }
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}

main().catch((cause: unknown) => {
  console.error(cause instanceof Error ? cause.message : "Неизвестная ошибка локальной индексации.");
  process.exitCode = 1;
});

import { resolve } from "node:path";
import { DOCUMENT_INDEX_CONFIG } from "../src/lib/document-config";
import { DocumentEmbeddingClient } from "../src/lib/document-embeddings";
import { indexDocuments } from "../src/lib/document-indexer";
import { SqliteDocumentStore } from "../src/lib/document-store";

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY?.trim()) throw new Error("Добавьте OPENROUTER_API_KEY в .env.local перед индексацией.");
  const client = new DocumentEmbeddingClient(process.env.OPENROUTER_API_KEY);
  const root = process.cwd();
  const databasePath = resolve(root, DOCUMENT_INDEX_CONFIG.databasePath);
  const reportPath = resolve(root, DOCUMENT_INDEX_CONFIG.reportPath);
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("Индексация прервана пользователем."));
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const store = new SqliteDocumentStore(databasePath);
  try {
    const report = await indexDocuments({ root, store, client, signal: controller.signal, onProgress: console.log });
    console.log(`SQLite: ${databasePath}\nСравнение: ${reportPath}`);
    for (const item of report.comparison) {
      console.log(`${item.strategy}: ${item.chunks} чанков; HitRate@5 ${(item.hitRateAt5 * 100).toFixed(1)}%; MRR@5 ${item.mrrAt5.toFixed(3)}; эмбеддинги ${(item.embeddingMs / 1000).toFixed(1)} с.`);
    }
  } finally {
    store.close();
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Неизвестная ошибка индексации документов.");
  process.exitCode = 1;
});

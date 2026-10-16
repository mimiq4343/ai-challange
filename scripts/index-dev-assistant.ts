import { resolve } from "node:path";
import { DEV_ASSISTANT_INDEX_CONFIG as CONFIG } from "../src/lib/dev-assistant-config";
import questions from "../src/lib/dev-assistant-questions.json";
import { indexDocuments } from "../src/lib/document-indexer";
import { SqliteDocumentStore } from "../src/lib/document-store";
import { LocalDocumentEmbeddingClient } from "../src/lib/local-document-embeddings";
import { projectDocumentSources } from "../src/lib/project-docs";
import { prepareRagModel } from "../src/lib/rag-model-download";

async function main(): Promise<void> {
  const root = process.cwd();
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("Индексация прервана пользователем."));
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    await prepareRagModel(root, controller.signal, console.log);
    const sources = await projectDocumentSources(root);
    console.log(`Документация проекта: ${sources.join(", ")}`);
    const client = new LocalDocumentEmbeddingClient(resolve(root, CONFIG.modelPath));
    const store = new SqliteDocumentStore(resolve(root, CONFIG.databasePath), CONFIG);
    try {
      const report = await indexDocuments({ root, store, client, config: CONFIG, sources, questions,
        countTokens: (text) => client.countTokens(text), signal: controller.signal, onProgress: console.log });
      console.log(`Модель: ${report.model}; размерность: ${report.dimensions}; SQLite: ${CONFIG.databasePath}`);
      for (const item of report.comparison) console.log(`${item.strategy}: ${item.chunks} чанков; HitRate@5 ${(item.hitRateAt5 * 100).toFixed(1)}%.`);
    } finally { store.close(); }
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}

main().catch((cause: unknown) => {
  console.error(cause instanceof Error ? cause.message : "Неизвестная ошибка индексации документации.");
  process.exitCode = 1;
});

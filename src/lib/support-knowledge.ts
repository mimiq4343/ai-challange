import { resolve } from "node:path";
import { SUPPORT_CONFIG, SUPPORT_INDEX_CONFIG as CONFIG } from "./support-config";
import { loadDocumentCorpus } from "./document-corpus";
import { rankDocumentChunks } from "./document-comparison";
import type { DocumentEmbeddingClient } from "./document-embeddings";
import { SqliteDocumentStore } from "./document-store";
import { SupportDataError } from "./support-data";
import type { SupportSearch } from "./support-types";

export function createKnowledgeSearch(root: string, embedder: Pick<DocumentEmbeddingClient, "embed">) {
  let nextSource = 1;
  return async (query: string, limit: number, signal?: AbortSignal): Promise<SupportSearch> => {
    const store = new SqliteDocumentStore(resolve(root, CONFIG.databasePath), CONFIG);
    let index;
    try { index = store.readIndexVectors(CONFIG.strategy); } finally { store.close(); }
    if (!index.report || !index.chunks.length) throw new SupportDataError("База знаний не проиндексирована. Выполните npm run support:index.", 503);
    if (index.report.model !== CONFIG.model || index.report.dimensions !== CONFIG.dimensions) throw new SupportDataError("Модель индекса не совпадает с поиском. Выполните npm run support:index.", 503);
    const corpus = await loadDocumentCorpus(root, SUPPORT_CONFIG.sources);
    signal?.throwIfAborted();
    const embedded = await embedder.embed([query], "search_query", signal);
    const results = rankDocumentChunks(index.chunks, embedded.vectors[0], CONFIG.dimensions, limit)
      .filter(({ score }) => score >= SUPPORT_CONFIG.minScore)
      .map(({ chunk, score }) => ({ id: `S${nextSource++}`, source: chunk.source, section: chunk.section, startLine: chunk.startLine, endLine: chunk.endLine, text: chunk.text, score: Math.round(score * 1000) / 1000 }));
    return { results, stale: corpus.hash !== index.report.corpus.hash };
  };
}

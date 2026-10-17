import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { rankDocumentChunks } from "./document-comparison";
import { loadDocumentCorpus } from "./document-corpus";
import type { DocumentEmbeddingClient } from "./document-embeddings";
import { SqliteDocumentStore } from "./document-store";
import { DEV_ASSISTANT_CORPUS as CORPUS, DEV_ASSISTANT_INDEX_CONFIG as CONFIG } from "./dev-assistant-config";
import type { DocsSearchResult, ProjectToolOutput } from "./project-tool-schemas";

export class ProjectDocsError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProjectDocsError";
  }
}

/** Файлы корпуса: README, AGENTS.md, все .md из docs/ и модули *-schema.ts. */
export async function projectDocumentSources(root: string): Promise<string[]> {
  const docs = (await readdir(join(root, CORPUS.markdownDirectory), { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"));
  if (!docs.length) throw new ProjectDocsError(`В ${CORPUS.markdownDirectory}/ нет Markdown-документов.`);
  const schemas = (await readdir(join(root, CORPUS.schemaDirectory), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(CORPUS.schemaSuffix))
    .map((entry) => `${CORPUS.schemaDirectory}/${entry.name}`);
  return [...CORPUS.files, ...docs, ...schemas].sort();
}

type Embedder = Pick<DocumentEmbeddingClient, "embed">;

// Номера источников сквозные в пределах одного MCP-сервера, то есть одного /help:
// повторный поиск не переиспользует S1 для другого фрагмента.
export function createDocsSearch(root: string, embedder: Embedder) {
  let nextSource = 1;
  return async function searchDocs(query: string, limit: number, signal?: AbortSignal): Promise<ProjectToolOutput<"search_docs">> {
    const store = new SqliteDocumentStore(join(root, CONFIG.databasePath), CONFIG);
    let index;
    try { index = store.readIndexVectors(CONFIG.strategy); } finally { store.close(); }
    if (!index.report || !index.chunks.length) {
      throw new ProjectDocsError("Индекс документации не создан. Выполните npm run dev-assistant:index.");
    }
    if (index.report.model !== CONFIG.model || index.report.dimensions !== CONFIG.dimensions) {
      throw new ProjectDocsError("Модель индекса документации не совпадает с поиском. Пересоздайте его: npm run dev-assistant:index.");
    }
    const current = await loadDocumentCorpus(root, await projectDocumentSources(root));
    signal?.throwIfAborted();
    const embedded = await embedder.embed([query], "search_query", signal);
    const results: DocsSearchResult[] = rankDocumentChunks(index.chunks, embedded.vectors[0], CONFIG.dimensions, limit)
      .map(({ chunk, score }) => ({
        id: `S${nextSource++}`, source: chunk.source, section: chunk.section,
        startLine: chunk.startLine, endLine: chunk.endLine, score: Math.round(score * 1000) / 1000, text: chunk.text,
      }));
    return { indexId: index.report.id, stale: current.hash !== index.report.corpus.hash, results };
  };
}

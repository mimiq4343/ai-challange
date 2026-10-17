import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { CODE_REVIEW_CONFIG as LIMITS, CODE_REVIEW_INDEX_CONFIG as CONFIG } from "./code-review-config";
import { loadReviewCorpus } from "./code-review-git";
import type { ReviewFile, ReviewSource } from "./code-review-types";
import { chunkDocuments } from "./document-chunking";
import { rankDocumentChunks } from "./document-comparison";
import { validateEmbedding, type DocumentEmbeddingClient } from "./document-embeddings";
import type { DocumentChunk, EmbeddedChunk } from "./document-types";
import { openChatDatabase, releaseChatDatabase } from "./sqlite-database";

type Embedder = Pick<DocumentEmbeddingClient, "embed"> & { countTokens(text: string): Promise<number> };
export type ReviewIndex = { id: string; baseSha: string; model: string; dimensions: number; chunks: EmbeddedChunk[] };

export async function buildReviewIndex(options: {
  root: string; baseSha: string; indexRoot: string; client: Embedder;
  signal?: AbortSignal; onProgress?: (message: string) => void;
}): Promise<ReviewIndex> {
  const { root, baseSha, indexRoot, client, signal, onProgress } = options;
  const documents = await loadReviewCorpus(root, baseSha, signal);
  onProgress?.(`RAG: загружено ${documents.length} файлов из base ${baseSha}; структурный чанкинг.`);
  const chunks: DocumentChunk[] = [];
  for (const [i, document] of documents.entries()) {
    chunks.push(...await chunkDocuments([document], "structural", async (text) => {
      signal?.throwIfAborted();
      return client.countTokens(text);
    }, CONFIG));
    if ((i + 1) % 20 === 0) onProgress?.(`RAG: разбито ${i + 1}/${documents.length} файлов.`);
  }
  onProgress?.(`RAG: ${documents.length} файлов, ${chunks.length} структурных чанков.`);
  const embedded: EmbeddedChunk[] = [];
  for (let offset = 0; offset < chunks.length; offset += CONFIG.batchSize) {
    signal?.throwIfAborted();
    const batch = chunks.slice(offset, offset + CONFIG.batchSize);
    const response = await client.embed(batch.map((chunk) => chunk.text), "search_document", signal);
    if (response.vectors.length !== batch.length) throw new Error("Эмбеддер вернул неверное число векторов.");
    for (const [i, chunk] of batch.entries()) {
      validateEmbedding(response.vectors[i], CONFIG.dimensions);
      embedded.push({ ...chunk, embedding: response.vectors[i].map(Math.fround) });
    }
    if (offset % (CONFIG.batchSize * 20) === 0) onProgress?.(`RAG: обработано ${embedded.length}/${chunks.length} чанков.`);
  }
  signal?.throwIfAborted();
  const index: ReviewIndex = { id: randomUUID(), baseSha, model: CONFIG.model, dimensions: CONFIG.dimensions, chunks: embedded };
  const path = join(indexRoot, CONFIG.databasePath);
  const database = openChatDatabase(path);
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS review_index (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1), metadata TEXT NOT NULL CHECK (json_valid(metadata))
    ) STRICT;
    CREATE TABLE IF NOT EXISTS review_chunks (
      id TEXT PRIMARY KEY, metadata TEXT NOT NULL CHECK (json_valid(metadata)), embedding BLOB NOT NULL
    ) STRICT;`);
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec("DELETE FROM review_chunks; DELETE FROM review_index;");
      const { chunks: _chunks, ...metadata } = index;
      void _chunks;
      database.prepare("INSERT INTO review_index VALUES (1, ?)").run(JSON.stringify(metadata));
      const insert = database.prepare("INSERT INTO review_chunks VALUES (?, ?, ?)");
      for (const { embedding, ...chunk } of embedded) {
        const bytes = Buffer.alloc(CONFIG.dimensions * 4);
        embedding.forEach((value, i) => bytes.writeFloatLE(value, i * 4));
        insert.run(chunk.chunkId, JSON.stringify(chunk), bytes);
      }
      database.exec("COMMIT");
    } catch (cause) { database.exec("ROLLBACK"); throw cause; }
  } finally { releaseChatDatabase(path); }
  return index;
}

export function readReviewIndex(path: string, baseSha: string): ReviewIndex {
  const database = openChatDatabase(path);
  try {
    database.exec("BEGIN");
    try {
      const row = database.prepare("SELECT metadata FROM review_index WHERE singleton = 1").get() as { metadata: string } | undefined;
      if (!row) throw new Error("RAG-индекс ревью отсутствует.");
      const metadata = JSON.parse(row.metadata) as Omit<ReviewIndex, "chunks">;
      if (metadata.baseSha !== baseSha) throw new Error("SHA базового коммита не совпадает с индексом.");
      if (metadata.model !== CONFIG.model || metadata.dimensions !== CONFIG.dimensions) throw new Error("Модель RAG-индекса не совпадает с конфигурацией.");
      const rows = database.prepare("SELECT metadata, embedding FROM review_chunks ORDER BY id").all() as { metadata: string; embedding: Uint8Array }[];
      if (!rows.length) throw new Error("RAG-индекс пуст.");
      const chunks = rows.map((row) => {
        const bytes = Buffer.from(row.embedding);
        if (bytes.length !== CONFIG.dimensions * 4) throw new Error("Повреждён вектор RAG-индекса.");
        const embedding = Array.from({ length: CONFIG.dimensions }, (_, i) => bytes.readFloatLE(i * 4));
        validateEmbedding(embedding, CONFIG.dimensions);
        return { ...JSON.parse(row.metadata), embedding } as EmbeddedChunk;
      });
      database.exec("COMMIT");
      return { ...metadata, chunks };
    } catch (cause) { database.exec("ROLLBACK"); throw cause; }
  } finally { releaseChatDatabase(path); }
}

export async function retrieveReviewContext(index: ReviewIndex, embedder: Pick<DocumentEmbeddingClient, "embed">, file: ReviewFile, signal: AbortSignal): Promise<ReviewSource[]> {
  signal.throwIfAborted();
  const query = `${file.path}\n${file.previousPath ?? ""}\n${file.patch.split("\n").filter((line) => /^[+-][^+-]/.test(line)).join("\n")}`.slice(0, LIMITS.queryCharacters);
  const { vectors } = await embedder.embed([query], "search_query", signal);
  const docs = index.chunks.filter((chunk) => chunk.source.endsWith(".md"));
  // При переименовании imports важны: они показывают зависимость от старого пути.
  const code = index.chunks.filter((chunk) => /\.tsx?$/.test(chunk.source) && (file.previousPath !== undefined || !["ImportDeclaration", "ImportEqualsDeclaration"].includes(chunk.section)));
  if (!docs.length || !code.length) throw new Error("RAG-индекс должен содержать документацию и код.");
  const hits = [
    ...rankDocumentChunks(docs, vectors[0], index.dimensions, LIMITS.docsTopK),
    ...rankDocumentChunks(code, vectors[0], index.dimensions, LIMITS.codeTopK),
  ];
  return hits.map(({ chunk, score }, i) => ({
    id: `S${i + 1}`, source: chunk.source, section: chunk.section, startLine: chunk.startLine, endLine: chunk.endLine,
    text: chunk.text, score: Math.round(score * 1000) / 1000,
  }));
}

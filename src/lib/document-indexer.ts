import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { chunkDocuments } from "./document-chunking";
import { compareDocumentStrategy, validateRetrievalQuestions } from "./document-comparison";
import { DOCUMENT_INDEX_CONFIG } from "./document-config";
import { loadDocumentCorpus } from "./document-corpus";
import type { DocumentEmbeddingClient } from "./document-embeddings";
import questionsManifest from "./document-questions.json";
import type { SqliteDocumentStore } from "./document-store";
import type { DocumentIndexReport, EmbeddedChunk, RetrievalQuestion } from "./document-types";
import { countTextTokens } from "./token-counter";

type IndexOptions = {
  root: string;
  store: SqliteDocumentStore;
  client: Pick<DocumentEmbeddingClient, "embed">;
  sources?: readonly string[];
  questions?: readonly RetrievalQuestion[];
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
};

function batches<T>(items: readonly T[], text: (item: T) => string): T[][] {
  const result: T[][] = [];
  let batch: T[] = [];
  let characters = 0;
  for (const item of items) {
    const length = text(item).length;
    if (length > DOCUMENT_INDEX_CONFIG.batchCharacters) throw new Error("Один текст превышает лимит пакета OpenRouter.");
    if (batch.length && (batch.length === DOCUMENT_INDEX_CONFIG.batchSize || characters + length > DOCUMENT_INDEX_CONFIG.batchCharacters)) {
      result.push(batch); batch = []; characters = 0;
    }
    batch.push(item); characters += length;
  }
  if (batch.length) result.push(batch);
  return result;
}

export async function indexDocuments(options: IndexOptions): Promise<DocumentIndexReport> {
  options.signal?.throwIfAborted();
  const lockPath = resolve(options.root, DOCUMENT_INDEX_CONFIG.runLockPath);
  await mkdir(dirname(lockPath), { recursive: true });
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Индексация уже выполняется: ${lockPath}. Если предыдущий процесс аварийно завершился, убедитесь, что он остановлен, и удалите этот файл блокировки.`, { cause });
    }
    throw new Error(`Не удалось создать блокировку индекса ${lockPath}.`, { cause });
  }
  try {
    await lock.writeFile(`${process.pid}\n`);
    return await buildIndex(options);
  } finally {
    await lock.close();
    await rm(lockPath);
  }
}

async function buildIndex(options: IndexOptions): Promise<DocumentIndexReport> {
  const { root, store, client, signal, onProgress } = options;
  signal?.throwIfAborted();
  const corpus = await loadDocumentCorpus(root, options.sources);
  const questions = options.questions ?? questionsManifest;
  validateRetrievalQuestions(corpus.documents, questions);
  onProgress?.(`Корпус: ${corpus.documents.length} файлов, ${corpus.characters} символов, ~${corpus.estimatedPages} страниц по ${corpus.charactersPerPage} символов.`);
  const countTokens = (text: string) => countTextTokens(text, DOCUMENT_INDEX_CONFIG.tokenizer);
  const strategies: { strategy: "fixed" | "structural"; chunks: EmbeddedChunk[]; embeddingMs: number }[] = [];
  let providerRequests = 0;
  let providerTokens = 0;
  for (const strategy of ["fixed", "structural"] as const) {
    signal?.throwIfAborted();
    const chunks = await chunkDocuments(corpus.documents, strategy, countTokens);
    const groups = batches(chunks, (chunk) => chunk.text);
    onProgress?.(`${strategy}: ${chunks.length} чанков, ${groups.length} пакетов эмбеддингов.`);
    const embedded: EmbeddedChunk[] = [];
    const started = performance.now();
    for (const [index, group] of groups.entries()) {
      signal?.throwIfAborted();
      const response = await client.embed(group.map((chunk) => chunk.text), "search_document", signal);
      providerRequests++;
      providerTokens += response.tokens;
      group.forEach((chunk, i) => embedded.push({ ...chunk, embedding: response.vectors[i].map(Math.fround) }));
      onProgress?.(`${strategy}: пакет ${index + 1}/${groups.length} сохранён в памяти.`);
    }
    strategies.push({ strategy, chunks: embedded, embeddingMs: Math.round(performance.now() - started) });
  }
  const queryVectors: number[][] = [];
  for (const group of batches(questions, (question) => question.question)) {
    signal?.throwIfAborted();
    const response = await client.embed(group.map((question) => question.question), "search_query", signal);
    queryVectors.push(...response.vectors.map((vector) => vector.map(Math.fround)));
    providerRequests++;
    providerTokens += response.tokens;
  }
  signal?.throwIfAborted();
  const { documents, ...corpusMetadata } = corpus;
  const report: DocumentIndexReport = {
    id: randomUUID(), createdAt: new Date().toISOString(), model: DOCUMENT_INDEX_CONFIG.model,
    dimensions: DOCUMENT_INDEX_CONFIG.dimensions,
    corpus: { ...corpusMetadata, files: documents.length },
    chunking: { maxTokens: DOCUMENT_INDEX_CONFIG.maxTokens, overlapTokens: DOCUMENT_INDEX_CONFIG.overlapTokens },
    providerRequests, providerTokens,
    comparison: strategies.map(({ strategy, chunks, embeddingMs }) => compareDocumentStrategy(strategy, chunks, questions, queryVectors, embeddingMs, DOCUMENT_INDEX_CONFIG.dimensions)),
  };
  signal?.throwIfAborted();
  store.replaceIndex(report, strategies.flatMap((item) => item.chunks));
  onProgress?.(`Индекс ${report.id} сохранён одной транзакцией.`);
  const reportPath = resolve(root, DOCUMENT_INDEX_CONFIG.reportPath);
  const temporaryReport = `${reportPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryReport, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
    await rename(temporaryReport, reportPath);
  } catch (cause) {
    throw new Error(`Индекс сохранён в SQLite, но экспорт сравнения в ${reportPath} не удался.`, { cause });
  } finally {
    await rm(temporaryReport, { force: true });
  }
  return report;
}

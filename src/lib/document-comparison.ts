import { documentSections } from "./document-chunking";
import { validateEmbedding } from "./document-embeddings";
import type { ChunkStrategy, CorpusDocument, EmbeddedChunk, RetrievalQuestion, StrategyComparison } from "./document-types";

export function validateRetrievalQuestions(documents: readonly CorpusDocument[], questions: readonly RetrievalQuestion[]): void {
  if (!questions.length || new Set(questions.map((question) => question.id)).size !== questions.length) {
    throw new Error("Нужен непустой набор контрольных вопросов с уникальными ID.");
  }
  for (const question of questions) {
    const document = documents.find((item) => item.source === question.source);
    if (!question.id.trim() || !question.question.trim() || !question.section.trim() || !question.evidence.trim() || !document ||
      !documentSections(document).some((section) => section.title.includes(question.section) && document.text.slice(section.start, section.end).includes(question.evidence))) {
      throw new Error(`Контрольный вопрос ${question.id} не подтверждён исходником ${question.source}.`);
    }
  }
}

function norm(vector: readonly number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

export function rankDocumentChunks(chunks: readonly EmbeddedChunk[], query: readonly number[], dimensions: number, limit: number): { chunk: EmbeddedChunk; score: number }[] {
  if (!chunks.length || !Number.isSafeInteger(limit) || limit < 1) throw new Error("Нужен непустой индекс и положительный top-k.");
  validateEmbedding(query, dimensions);
  const queryNorm = norm(query);
  return chunks.map((chunk) => {
    validateEmbedding(chunk.embedding, dimensions);
    return { chunk, score: chunk.embedding.reduce((sum, value, index) => sum + value * query[index], 0) / (norm(chunk.embedding) * queryNorm) };
  }).sort((a, b) => b.score - a.score || a.chunk.chunkId.localeCompare(b.chunk.chunkId)).slice(0, limit);
}

export function compareDocumentStrategy(
  strategy: ChunkStrategy,
  chunks: readonly EmbeddedChunk[],
  questions: readonly RetrievalQuestion[],
  queryVectors: readonly number[][],
  embeddingMs: number,
  dimensions: number,
): StrategyComparison {
  if (!chunks.length || !questions.length || questions.length !== queryVectors.length || chunks.some((chunk) => chunk.strategy !== strategy)) {
    throw new Error("Неполные данные сравнения стратегий индексации.");
  }
  const retrieval = questions.map((question, index) => {
    const hits = rankDocumentChunks(chunks, queryVectors[index], dimensions, 5).map(({ chunk, score }) => ({
      chunkId: chunk.chunkId, source: chunk.source, section: chunk.section,
      score,
      relevant: chunk.source === question.source && chunk.text.includes(question.evidence),
    }));
    const position = hits.findIndex((hit) => hit.relevant);
    return { questionId: question.id, question: question.question, expectedSource: question.source,
      expectedSection: question.section, expectedEvidence: question.evidence, rank: position < 0 ? null : position + 1, hits };
  });
  const tokenCounts = chunks.map((chunk) => chunk.tokenCount);
  const total = tokenCounts.reduce((sum, count) => sum + count, 0);
  return {
    strategy, chunks: chunks.length,
    tokens: { min: Math.min(...tokenCounts), max: Math.max(...tokenCounts), mean: total / chunks.length, total },
    boundaryCrossingChunks: chunks.filter((chunk) => chunk.boundaryCrossings > 0).length,
    embeddingMs, vectorBytes: chunks.length * dimensions * 4,
    hitRateAt5: retrieval.filter((item) => item.rank !== null).length / questions.length,
    mrrAt5: retrieval.reduce((sum, item) => sum + (item.rank === null ? 0 : 1 / item.rank), 0) / questions.length,
    retrieval,
  };
}

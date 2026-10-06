import "server-only";

import { ChatAgent } from "./chat-agent";
import type { CompressionLlmResponder } from "./compression-llm";
import { rankDocumentChunks } from "./document-comparison";
import type { DocumentEmbeddingClient } from "./document-embeddings";
import { localDocumentEmbedder } from "./local-document-embeddings";
import { SqliteDocumentStore } from "./document-store";
import { RAG_CONFIG, RAG_SYSTEM_PROMPT } from "./rag-config";
import { RAG_EMBEDDING_CONFIG } from "./rag-embedding-config";
import type { RagAnswer, RagMode, RagSource } from "./rag-types";
import { assertContextFits, countChatPrompt } from "./token-counter";

export class RagError extends Error {
  constructor(message: string, readonly status: 400 | 413 | 502 | 503, options?: ErrorOptions) {
    super(message, options);
    this.name = "RagError";
  }
}

type RagIndex = ReturnType<SqliteDocumentStore["readIndexVectors"]>;
export type RagRetrievalDependencies = { index: RagIndex; embedder: Pick<DocumentEmbeddingClient, "embed"> };

export function loadRagIndex(): RagIndex {
  const store = new SqliteDocumentStore(RAG_EMBEDDING_CONFIG.databasePath, RAG_EMBEDDING_CONFIG);
  try { return store.readIndexVectors(RAG_CONFIG.strategy); } finally { store.close(); }
}

export class RagAgent {
  constructor(private readonly llm: CompressionLlmResponder, private readonly retrieval?: RagRetrievalDependencies) {}

  static fromEnvironment(mode: "plain" | "rag" | "compare"): RagAgent {
    const llm = ChatAgent.fromEnvironment();
    if (mode === "plain") return new RagAgent(llm);
    return new RagAgent(llm, { index: loadRagIndex(), embedder: localDocumentEmbedder });
  }

  async respond(question: string, mode: RagMode, signal: AbortSignal): Promise<RagAnswer> {
    const content = question.trim();
    if (!content || content.length > RAG_CONFIG.maxQuestionCharacters || (mode !== "plain" && mode !== "rag")) {
      throw new RagError(`Нужен вопрос от 1 до ${RAG_CONFIG.maxQuestionCharacters} символов и режим plain или rag.`, 400);
    }
    const started = performance.now();
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(RAG_CONFIG.requestTimeoutMs)]);
    requestSignal.throwIfAborted();
    let sources: RagSource[] = [];
    let indexId: string | null = null;
    let embeddingTokens = 0;
    let retrievalMs = 0;
    if (mode === "rag") {
      const dependencies = this.retrieval;
      const report = dependencies?.index.report;
      if (!dependencies || !report || !dependencies.index.chunks.length) {
        throw new RagError("Индекс отсутствует. Выполните npm run rag:index перед RAG-запросом.", 503);
      }
      if (report.model !== RAG_EMBEDDING_CONFIG.model || report.dimensions !== RAG_EMBEDDING_CONFIG.dimensions) {
        throw new RagError("Модель или размерность индекса не совпадают с поиском. Пересоздайте индекс.", 503);
      }
      let embedded;
      try { embedded = await dependencies.embedder.embed([content], "search_query", requestSignal); }
      catch (cause) {
        requestSignal.throwIfAborted();
        throw new RagError("Не удалось вычислить локальный эмбеддинг вопроса. Проверьте модель через npm run rag:index.", 502, { cause });
      }
      sources = rankDocumentChunks(dependencies.index.chunks, embedded.vectors[0], report.dimensions, RAG_CONFIG.topK)
        .map(({ chunk, score }, index) => {
          const { embedding: _embedding, ...source } = chunk;
          void _embedding;
          return { ...source, id: `S${index + 1}`, score };
        });
      indexId = report.id;
      embeddingTokens = embedded.tokens;
      retrievalMs = performance.now() - started;
    }
    return generateRagAnswer(this.llm, { question: content, mode, sources, indexId, embeddingTokens, retrievalMs, started }, requestSignal);
  }
}

export async function generateRagAnswer(llm: CompressionLlmResponder, input: {
  question: string; mode: RagMode; sources: RagSource[]; indexId: string | null;
  embeddingTokens: number; retrievalMs: number; started: number;
}, requestSignal: AbortSignal): Promise<RagAnswer> {
  const { question, mode, sources, indexId, embeddingTokens, retrievalMs, started } = input;
  const request = mode === "plain" ? question : `QUESTION\n${question}\n\nCONTEXT_JSON\n${JSON.stringify(sources.map(({ id, source, section, startLine, endLine, text }) => ({ id, source, section, startLine, endLine, text })))}`;
  const systemMessages = [RAG_SYSTEM_PROMPT];
  if (mode === "rag" && sources.length === 0) systemMessages.push("RAG включён, но подходящих источников после отбора нет. Явно сообщи, что в найденных источниках нет ответа. Не выдумывай факты проекта и не предлагай включить RAG.");
  const options = { systemMessages, maxOutputTokens: RAG_CONFIG.maxOutputTokens, strictStream: true };
  const preflight = await countChatPrompt({ systemMessages: options.systemMessages, history: [], request, reservedOutputTokens: options.maxOutputTokens });
  assertContextFits(preflight);
  requestSignal.throwIfAborted();
  const generationStarted = performance.now();
  const response = await llm.respond([{ role: "user", content: request }], requestSignal, options);
  const answer = (await new Response(response.stream).text()).trim();
  requestSignal.throwIfAborted();
  if (!answer) throw new RagError("LLM вернула пустой ответ.", 502);
  if (answer.length > RAG_CONFIG.maxAnswerCharacters) throw new RagError("Ответ LLM превышает допустимый объём.", 502);
  if (await response.finishReason !== "stop") throw new RagError("LLM не завершила ответ полностью. Повторите запрос.", 502);
  const usage = await response.usage;
  if (!usage) throw new RagError("LLM не вернула корректную статистику токенов.", 502);
  const cited = [...new Set(Array.from(answer.matchAll(/\[(S\d+)\]/g), (match) => match[1]))];
  const known = new Set(sources.map((source) => source.id));
  return {
    mode, question, answer, model: llm.model, indexId, sources,
    citations: cited.filter((id) => known.has(id)), invalidCitations: cited.filter((id) => !known.has(id)), usage, embeddingTokens,
    retrievalMs: Math.round(retrievalMs), generationMs: Math.round(performance.now() - generationStarted), durationMs: Math.round(performance.now() - started),
  };
}

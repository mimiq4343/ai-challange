import "server-only";
import { randomUUID } from "node:crypto";
import { ChatAgent } from "./chat-agent";
import type { CompressionLlmResponder } from "./compression-llm";
import type { ProviderTokenUsage } from "./conversation-types";
import { rankDocumentChunks } from "./document-comparison";
import { localDocumentEmbedder } from "./local-document-embeddings";
import { generateRagAnswer, loadRagIndex, RagError, type RagRetrievalDependencies } from "./rag-agent";
import { RAG_CONFIG } from "./rag-config";
import { RAG_EMBEDDING_CONFIG } from "./rag-embedding-config";
import { QUERY_REWRITE_PROMPT, REFINEMENT_CONFIG, REFINEMENT_MODES, RELEVANCE_RERANK_PROMPT } from "./rag-refinement-config";
import type { RefinementAnswer, RefinementCandidate, RefinementRequestMode, RefinementSettings, RefinementStage } from "./rag-refinement-types";
import type { RagSource } from "./rag-types";
import { assertContextFits, countChatPrompt } from "./token-counter";

export function parseRefinementSettings(value: unknown): RefinementSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RagError("Нужны настройки candidateK, contextK и minRelevance.", 400);
  const settings = value as Record<string, unknown>;
  const { candidateK, contextK, minRelevance } = settings;
  if (Object.keys(settings).length !== 3 || !Number.isSafeInteger(candidateK) || !Number.isSafeInteger(contextK) || !Number.isInteger(minRelevance) ||
    (candidateK as number) < 1 || (candidateK as number) > REFINEMENT_CONFIG.maxCandidateK ||
    (contextK as number) < 1 || (contextK as number) > REFINEMENT_CONFIG.maxContextK || (contextK as number) > (candidateK as number) ||
    (minRelevance as number) < 0 || (minRelevance as number) > 10) {
    throw new RagError(`candidateK: 1–${REFINEMENT_CONFIG.maxCandidateK}; contextK: 1–${REFINEMENT_CONFIG.maxContextK} и не больше candidateK; minRelevance: целое 0–10.`, 400);
  }
  return { candidateK: candidateK as number, contextK: contextK as number, minRelevance: minRelevance as number };
}

export function sumRefinementUsage(usages: readonly ProviderTokenUsage[]): ProviderTokenUsage {
  return {
    promptTokens: usages.reduce((sum, usage) => sum + usage.promptTokens, 0),
    completionTokens: usages.reduce((sum, usage) => sum + usage.completionTokens, 0),
    totalTokens: usages.reduce((sum, usage) => sum + usage.totalTokens, 0),
    cacheHitTokens: usages.some((usage) => usage.cacheHitTokens === null) ? null : usages.reduce((sum, usage) => sum + usage.cacheHitTokens!, 0),
    cacheMissTokens: usages.some((usage) => usage.cacheMissTokens === null) ? null : usages.reduce((sum, usage) => sum + usage.cacheMissTokens!, 0),
  };
}

function objectPayload(text: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(text); }
  catch (cause) { throw new RagError("Этап обработки вернул недействительный JSON.", 502, { cause }); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RagError("Этап обработки должен вернуть JSON-объект.", 502);
  return value as Record<string, unknown>;
}

export class RagRefinementAgent {
  constructor(private readonly llm: CompressionLlmResponder, private readonly retrieval: RagRetrievalDependencies) {}

  static fromEnvironment(): RagRefinementAgent {
    return new RagRefinementAgent(ChatAgent.fromEnvironment(), { index: loadRagIndex(), embedder: localDocumentEmbedder });
  }

  private async stage(kind: RefinementStage["kind"], prompt: string, payload: unknown, signal: AbortSignal) {
    const started = performance.now();
    const stageSignal = AbortSignal.any([signal, AbortSignal.timeout(RAG_CONFIG.requestTimeoutMs)]);
    const request = JSON.stringify(payload);
    assertContextFits(await countChatPrompt({ systemMessages: [prompt], history: [], request, reservedOutputTokens: RAG_CONFIG.maxOutputTokens }));
    stageSignal.throwIfAborted();
    const response = await this.llm.respond([{ role: "user", content: request }], stageSignal, { systemMessages: [prompt], strictStream: true, maxOutputTokens: RAG_CONFIG.maxOutputTokens });
    const text = await new Response(response.stream).text();
    stageSignal.throwIfAborted();
    const usage = await response.usage;
    if (await response.finishReason !== "stop" || !usage || !text.trim() || text.length > REFINEMENT_CONFIG.maxStageCharacters) throw new RagError("Этап обработки не завершился корректно или не вернул статистику токенов.", 502);
    return { payload: objectPayload(text), metrics: { id: randomUUID(), kind, usage, durationMs: Math.round(performance.now() - started) } };
  }

  private async rewrite(question: string, signal: AbortSignal) {
    const result = await this.stage("rewrite", QUERY_REWRITE_PROMPT, { question }, signal);
    const query = result.payload.query;
    if (Object.keys(result.payload).length !== 1 || typeof query !== "string" || !query.trim() || query.length > REFINEMENT_CONFIG.maxRewriteCharacters) throw new RagError("Rewrite должен вернуть одну непустую поисковую формулировку допустимой длины.", 502);
    const identifiers = question.match(/\b(?:[a-z]+[A-Z][A-Za-z0-9]*|[A-Z][a-z]+[A-Z][A-Za-z0-9]*|[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_.]*|[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+)\b/g) ?? [];
    if (identifiers.some((identifier) => !query.includes(identifier))) throw new RagError("Rewrite потерял исходный идентификатор кода. Запрос не отправлен в поиск.", 502);
    return { query: query.trim(), metrics: result.metrics };
  }

  private async retrieve(query: string, candidateK: number, signal: AbortSignal) {
    const started = performance.now();
    let embedded;
    try { embedded = await this.retrieval.embedder.embed([query], "search_query", signal); }
    catch (cause) { signal.throwIfAborted(); throw new RagError("Не удалось вычислить локальный эмбеддинг поискового запроса.", 502, { cause }); }
    const sources = rankDocumentChunks(this.retrieval.index.chunks, embedded.vectors[0], RAG_EMBEDDING_CONFIG.dimensions, candidateK)
      .map(({ chunk, score }, index) => {
        const { embedding: _embedding, ...source } = chunk;
        void _embedding;
        return { ...source, score, id: `C${index + 1}` };
      });
    return { sources, tokens: embedded.tokens, durationMs: Math.round(performance.now() - started) };
  }

  private async rerank(question: string, sources: RagSource[], signal: AbortSignal) {
    const result = await this.stage("rerank", RELEVANCE_RERANK_PROMPT, { question,
      candidates: sources.map(({ id, source, section, startLine, endLine, text }) => ({ id, source, section, startLine, endLine, text })) }, signal);
    const rows = result.payload.results;
    if (Object.keys(result.payload).length !== 1 || !Array.isArray(rows) || rows.length !== sources.length) throw new RagError("Reranker должен оценить каждый найденный фрагмент ровно один раз.", 502);
    const scores = new Map<string, { score: number; reason: string }>();
    const known = new Set(sources.map((item) => item.id));
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length !== 3 || typeof row.id !== "string" || !known.has(row.id) || scores.has(row.id) ||
        !Number.isInteger(row.score) || row.score < 0 || row.score > 10 || typeof row.reason !== "string" || !row.reason.trim() || row.reason.length > REFINEMENT_CONFIG.maxReasonCharacters) throw new RagError("Reranker вернул неверный ID, оценку или обоснование.", 502);
      scores.set(row.id, { score: row.score, reason: row.reason.trim() });
    }
    return { scores, metrics: result.metrics };
  }

  async respond(question: string, mode: RefinementRequestMode, requestedSettings: RefinementSettings, signal: AbortSignal): Promise<RefinementAnswer[]> {
    const content = question.trim();
    const settings = parseRefinementSettings(requestedSettings);
    if (!content || content.length > RAG_CONFIG.maxQuestionCharacters || (mode !== "compare" && !REFINEMENT_MODES.includes(mode))) throw new RagError("Нужен непустой вопрос допустимой длины и режим baseline, rewrite, refined или compare.", 400);
    const report = this.retrieval.index.report;
    if (!report || !this.retrieval.index.chunks.length || report.model !== RAG_EMBEDDING_CONFIG.model || report.dimensions !== RAG_EMBEDDING_CONFIG.dimensions) throw new RagError("Нужен совместимый локальный индекс. Выполните npm run rag:index.", 503);
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(REFINEMENT_CONFIG.requestTimeoutMs)]);
    requestSignal.throwIfAborted();
    const modes = mode === "compare" ? REFINEMENT_MODES : [mode];
    const answers: RefinementAnswer[] = [];
    let rewritten: Awaited<ReturnType<RagRefinementAgent["rewrite"]>> | undefined;
    let rewrittenRetrieval: Awaited<ReturnType<RagRefinementAgent["retrieve"]>> | undefined;
    for (const selectedMode of modes) {
      const stages: RefinementStage[] = [];
      let query = content;
      let retrieved;
      if (selectedMode === "baseline") retrieved = await this.retrieve(query, settings.candidateK, requestSignal);
      else {
        rewritten ??= await this.rewrite(content, requestSignal);
        query = rewritten.query;
        stages.push(rewritten.metrics);
        rewrittenRetrieval ??= await this.retrieve(query, settings.candidateK, requestSignal);
        retrieved = rewrittenRetrieval;
      }
      let candidates: RefinementCandidate[] = retrieved.sources.map((source, index) => ({ source, relevance: null, reason: null, decision: index < settings.contextK ? "selected" : "outside_top_k" }));
      if (selectedMode === "refined") {
        const ranked = await this.rerank(content, retrieved.sources, requestSignal);
        stages.push(ranked.metrics);
        const ordered = [...retrieved.sources].sort((a, b) => ranked.scores.get(b.id)!.score - ranked.scores.get(a.id)!.score || b.score - a.score || a.chunkId.localeCompare(b.chunkId));
        const chosen = new Set(ordered.filter((item) => ranked.scores.get(item.id)!.score >= settings.minRelevance).slice(0, settings.contextK).map((item) => item.id));
        candidates = retrieved.sources.map((source) => {
          const evaluation = ranked.scores.get(source.id)!;
          return { source, relevance: evaluation.score, reason: evaluation.reason, decision: evaluation.score < settings.minRelevance ? "below_threshold" : chosen.has(source.id) ? "selected" : "outside_top_k" };
        });
      }
      const sources = candidates.filter((item) => item.decision === "selected").sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0) || b.source.score - a.source.score || a.source.chunkId.localeCompare(b.source.chunkId))
        .map(({ source }, index) => ({ ...source, id: `S${index + 1}` }));
      const generationSignal = AbortSignal.any([requestSignal, AbortSignal.timeout(RAG_CONFIG.requestTimeoutMs)]);
      const result = await generateRagAnswer(this.llm, { question: content, mode: "rag", sources, indexId: report.id, embeddingTokens: retrieved.tokens,
        retrievalMs: retrieved.durationMs + stages.reduce((sum, stage) => sum + stage.durationMs, 0), started: performance.now() }, generationSignal);
      const durationMs = result.durationMs + retrieved.durationMs + stages.reduce((sum, stage) => sum + stage.durationMs, 0);
      answers.push({ mode: selectedMode, query, settings, result: { ...result, durationMs }, candidates, stages, usage: sumRefinementUsage([result.usage, ...stages.map((stage) => stage.usage)]), durationMs });
    }
    requestSignal.throwIfAborted();
    return answers;
  }
}

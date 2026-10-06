import "server-only";
import { ChatAgent, type ChatMessage } from "./chat-agent";
import type { CompressionLlmResponder } from "./compression-llm";
import type { ProviderTokenUsage } from "./conversation-types";
import { localDocumentEmbedder } from "./local-document-embeddings";
import { loadRagIndex, RagError, type RagRetrievalDependencies } from "./rag-agent";
import { RAG_CONFIG } from "./rag-config";
import { GROUNDED_ANSWER_PROMPT } from "./rag-grounding-config";
import type { GroundedAnswer } from "./rag-grounding-types";
import { parseGroundedAnswer } from "./rag-grounding-validation";
import { RagRefinementAgent, sumRefinementUsage } from "./rag-refinement-agent";
import { REFINEMENT_CONFIG } from "./rag-refinement-config";
import type { RefinementSettings } from "./rag-refinement-types";
import { assertContextFits, countChatPrompt } from "./token-counter";
import { RAG_CHAT_ANSWER_RULES, RAG_CHAT_GROUNDED_PROMPT } from "./rag-chat-config";
import { quoteOptions, resolveQuoteSelection } from "./rag-chat-quotes";
import type { RagTaskState } from "./rag-chat-types";

export class GroundedRagAgent {
  constructor(private readonly llm: CompressionLlmResponder, private readonly retrieval: RagRetrievalDependencies) {}

  static fromEnvironment(): GroundedRagAgent {
    return new GroundedRagAgent(ChatAgent.fromEnvironment(), { index: loadRagIndex(), embedder: localDocumentEmbedder });
  }

  async respond(question: string, settings: RefinementSettings, signal: AbortSignal,
    conversation?: { history: ChatMessage[]; taskState: RagTaskState; retrievalQuestion: string }): Promise<GroundedAnswer> {
    const started = performance.now();
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(REFINEMENT_CONFIG.requestTimeoutMs)]);
    const context = await new RagRefinementAgent(this.llm, this.retrieval).prepareContext(conversation?.retrievalQuestion ?? question, settings, requestSignal);
    let parsed: ReturnType<typeof parseGroundedAnswer>;
    let usage: ProviderTokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheHitTokens: null, cacheMissTokens: null };
    let generationMs = 0;
    if (!context.sources.length) {
      parsed = { status: "unknown", answer: "Не знаю: релевантность найденных фрагментов ниже порога.", clarification: "Уточните, о какой функции, файле или сценарии Flash Chat идёт речь?", sources: [], quotes: [], citations: [] };
    } else {
      const generationSignal = AbortSignal.any([requestSignal, AbortSignal.timeout(RAG_CONFIG.requestTimeoutMs)]);
      const systemMessages = conversation ? [RAG_CHAT_GROUNDED_PROMPT, RAG_CHAT_ANSWER_RULES] : [GROUNDED_ANSWER_PROMPT];
      const sources = context.sources.map((source) => ({ ...source, quoteOptions: conversation ? quoteOptions(source.text) : [] }));
      const request = JSON.stringify({ question: question.trim(), ...(conversation ? { history: conversation.history, taskState: conversation.taskState } : {}), context: sources.map(({ id, source, section, chunkId, startLine, endLine, text, quoteOptions }) => ({ id, source, section, chunkId, startLine, endLine, text, ...(conversation ? { quoteOptions } : {}) })) });
      assertContextFits(await countChatPrompt({ systemMessages, history: [], request, reservedOutputTokens: RAG_CONFIG.maxOutputTokens }));
      generationSignal.throwIfAborted();
      const generationStarted = performance.now();
      const response = await this.llm.respond([{ role: "user", content: request }], generationSignal, { systemMessages, strictStream: true, maxOutputTokens: RAG_CONFIG.maxOutputTokens });
      const text = await new Response(response.stream).text();
      generationSignal.throwIfAborted();
      const providerUsage = await response.usage;
      if (await response.finishReason !== "stop" || !providerUsage || !text.trim() || text.length > RAG_CONFIG.maxAnswerCharacters) throw new RagError("Ответ с цитатами не завершён, слишком велик или не содержит статистику токенов.", 502);
      parsed = parseGroundedAnswer(conversation ? resolveQuoteSelection(text, sources) : text, context.sources);
      usage = providerUsage;
      generationMs = Math.round(performance.now() - generationStarted);
    }
    requestSignal.throwIfAborted();
    const durationMs = Math.round(performance.now() - started);
    const result = { mode: "rag" as const, question: question.trim(), answer: parsed.clarification ? `${parsed.answer}\n\n${parsed.clarification}` : parsed.answer,
      model: this.llm.model, indexId: context.indexId, sources: parsed.sources, citations: parsed.citations, invalidCitations: [], usage,
      embeddingTokens: context.embeddingTokens, retrievalMs: context.retrievalMs, generationMs, durationMs };
    return { mode: "refined", status: parsed.status, clarification: parsed.clarification, quotes: parsed.quotes, result,
      query: context.query, settings: context.settings, candidates: context.candidates, stages: context.stages,
      usage: sumRefinementUsage([usage, ...context.stages.map((stage) => stage.usage)]), durationMs };
  }
}

import "server-only";
import { ChatAgent } from "./chat-agent";
import type { CompressionLlmResponder } from "./compression-llm";
import { ConversationNotFoundError, getConversationStore, type SqliteConversationStore } from "./conversation-store";
import { localDocumentEmbedder } from "./local-document-embeddings";
import { loadRagIndex, RagError, type RagRetrievalDependencies } from "./rag-agent";
import { RAG_CONFIG } from "./rag-config";
import { RAG_CHAT_CONFIG } from "./rag-chat-config";
import type { RagChatSnapshot } from "./rag-chat-types";
import { GroundedRagAgent } from "./rag-grounding-agent";
import { parseRefinementSettings, sumRefinementUsage } from "./rag-refinement-agent";
import type { RefinementSettings } from "./rag-refinement-types";
import { updateRagTaskMemory } from "./rag-task-memory";

export class RagChatAgent {
  constructor(private readonly store: SqliteConversationStore, private readonly llm: CompressionLlmResponder, private readonly retrieval: RagRetrievalDependencies) {}

  static fromEnvironment(store: SqliteConversationStore = getConversationStore()): RagChatAgent {
    return new RagChatAgent(store, ChatAgent.fromEnvironment(), { index: loadRagIndex(), embedder: localDocumentEmbedder });
  }

  async respond(conversationId: string, content: string, settings: RefinementSettings, signal: AbortSignal): Promise<RagChatSnapshot> {
    const question = content.trim();
    if (!question || question.length > RAG_CONFIG.maxQuestionCharacters) throw new RagError("Нужен непустой вопрос длиной до 4000 символов.", 400);
    const requestedSettings = parseRefinementSettings(settings);
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(RAG_CHAT_CONFIG.requestTimeoutMs)]);
    requestSignal.throwIfAborted();
    const snapshot = this.store.getRagChat(conversationId);
    if (!snapshot) throw new ConversationNotFoundError(conversationId);
    const history = snapshot.messages.slice(-RAG_CHAT_CONFIG.historyMessages).map(({ role, content }) => ({ role, content }));
    const turn = snapshot.messages.filter((message) => message.role === "user").length + 1;
    const started = performance.now();
    const memory = await updateRagTaskMemory(this.llm, snapshot.taskState, history, question, turn,
      AbortSignal.any([requestSignal, AbortSignal.timeout(RAG_CONFIG.requestTimeoutMs)]));
    const answer = await new GroundedRagAgent(this.llm, this.retrieval).respond(question, requestedSettings, requestSignal,
      { history, taskState: memory.taskState, retrievalQuestion: memory.question });
    answer.usage = sumRefinementUsage([answer.usage, memory.usage]);
    answer.result.usage = answer.usage;
    answer.durationMs = Math.round(performance.now() - started);
    answer.result.durationMs = answer.durationMs;
    requestSignal.throwIfAborted();
    this.store.saveExchange(conversationId, question, answer.result.answer, undefined, undefined,
      { expectedLastMessageId: snapshot.messages.at(-1)?.id ?? null, taskState: memory.taskState, answer });
    return this.store.getRagChat(conversationId)!;
  }
}

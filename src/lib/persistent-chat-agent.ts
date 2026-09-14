import { ChatAgent, ChatAgentError, type ChatMessage } from "./chat-agent";
import {
  ConversationNotFoundError,
  getConversationStore,
  type SqliteConversationStore,
} from "./conversation-store";
import type { ChatAgentResponse, TokenBreakdown } from "./conversation-types";
import { calculateDeepSeekCost } from "./token-cost";
import { assertContextFits, countChatPrompt, countTextTokens } from "./token-counter";

type LlmResponder = {
  readonly model: string;
  respond(messages: ChatMessage[], signal: AbortSignal): Promise<ChatAgentResponse>;
};

export type PersistentChatResponse = {
  stream: ReadableStream<Uint8Array>;
  preflight: TokenBreakdown;
};

export class PersistentChatAgent {
  private readonly store: SqliteConversationStore;
  private readonly llm: LlmResponder;

  constructor(store: SqliteConversationStore, llm: LlmResponder) {
    this.store = store;
    this.llm = llm;
  }

  static fromEnvironment(
    store: SqliteConversationStore = getConversationStore(),
  ): PersistentChatAgent {
    return new PersistentChatAgent(store, ChatAgent.fromEnvironment());
  }

  async respond(
    conversationId: string,
    content: string,
    signal: AbortSignal,
  ): Promise<PersistentChatResponse> {
    if (!this.store.getConversation(conversationId)) {
      throw new ConversationNotFoundError(conversationId);
    }

    const history: ChatMessage[] = this.store
      .getMessages(conversationId)
      .map(({ role, content: savedContent }) => ({ role, content: savedContent }));
    const preflight = await countChatPrompt({ history, request: content });
    assertContextFits(preflight);

    const response = await this.llm.respond(
      [...history, { role: "user", content }],
      signal,
    );
    const chunks: Uint8Array[] = [];
    const stream = response.stream.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          chunks.push(chunk.slice());
          controller.enqueue(chunk);
        },
        flush: async () => {
          const totalBytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
          const completeResponse = new Uint8Array(totalBytes);
          let offset = 0;
          for (const chunk of chunks) {
            completeResponse.set(chunk, offset);
            offset += chunk.byteLength;
          }

          const assistantContent = new TextDecoder().decode(completeResponse);
          if (assistantContent.length === 0) {
            throw new ChatAgentError("API вернул пустой ответ.", "upstream");
          }

          const providerUsage = await response.usage;
          const responseTokens =
            providerUsage?.completionTokens ?? (await countTextTokens(assistantContent));
          const { tariffBand, costMicrosUsd } = calculateDeepSeekCost({
            promptTokens: providerUsage?.promptTokens ?? preflight.promptTokens,
            completionTokens: responseTokens,
            cacheHitTokens: providerUsage?.cacheHitTokens ?? null,
            cacheMissTokens: providerUsage?.cacheMissTokens ?? null,
            at: new Date(),
          });
          this.store.saveExchange(conversationId, content, assistantContent, {
            ...preflight,
            model: this.llm.model,
            responseTokens,
            providerUsage,
            source: providerUsage ? "provider" : "estimated",
            tariffBand,
            costMicrosUsd,
          });
        },
      }),
    );

    return { stream, preflight };
  }
}

import { ChatAgent, type ChatMessage } from "./chat-agent";
import { collectCompletedTextStream } from "./completed-text-stream";
import type { CompressionLlmResponder } from "./compression-llm";
import {
  ConversationNotFoundError,
  getConversationStore,
  type SqliteConversationStore,
} from "./conversation-store";
import type { TokenBreakdown } from "./conversation-types";
import { calculateDeepSeekCost } from "./token-cost";
import { assertContextFits, countChatPrompt, countTextTokens } from "./token-counter";

export type PersistentChatResponse = {
  stream: ReadableStream<Uint8Array>;
  preflight: TokenBreakdown;
};

export class PersistentChatAgent {
  private readonly store: SqliteConversationStore;
  private readonly llm: CompressionLlmResponder;

  constructor(
    store: SqliteConversationStore,
    llm: CompressionLlmResponder,
  ) {
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
    const stream = collectCompletedTextStream(
      response.stream,
      async (assistantContent) => {
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
    );

    return { stream, preflight };
  }
}

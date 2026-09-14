import "server-only";

import { ChatAgent, type ChatMessage } from "./chat-agent";
import { consumeRequiredProviderResponse, type CompressionLlmResponder } from "./compression-llm";
import type { SummaryCheckpoint } from "./compression-types";
import {
  buildSummaryRequest,
  selectCompressionWindow,
  SUMMARY_MAX_OUTPUT_TOKENS,
  SUMMARY_SYSTEM_PROMPT,
} from "./history-compression";
import {
  ConversationNotFoundError,
  getConversationStore,
  type SqliteConversationStore,
} from "./conversation-store";
import { assertContextFits, countChatPrompt } from "./token-counter";

export type PreparedCompressedHistory = {
  checkpoint: SummaryCheckpoint | null;
  rawTail: ChatMessage[];
  createdCheckpoints: SummaryCheckpoint[];
};

export class HistorySummarizer {
  constructor(
    private readonly store: SqliteConversationStore,
    private readonly llm: CompressionLlmResponder,
    private readonly now: () => Date = () => new Date(),
  ) {}

  static fromEnvironment(
    store: SqliteConversationStore = getConversationStore(),
  ): HistorySummarizer {
    return new HistorySummarizer(store, ChatAgent.fromEnvironment());
  }

  async prepare(
    conversationId: string,
    signal: AbortSignal,
  ): Promise<PreparedCompressedHistory> {
    if (!this.store.getConversation(conversationId)) {
      throw new ConversationNotFoundError(conversationId);
    }

    const createdCheckpoints: SummaryCheckpoint[] = [];
    while (true) {
      const checkpoint = this.store.getLatestConversationSummary(conversationId);
      const pending = this.store.getMessagesAfter(
        conversationId,
        checkpoint?.summarizedThroughMessageId ?? null,
      );
      const { batch, rawTail } = selectCompressionWindow(pending);
      if (batch.length === 0) {
        return {
          checkpoint,
          rawTail: rawTail.map(({ role, content }) => ({ role, content })),
          createdCheckpoints,
        };
      }

      const request = buildSummaryRequest(checkpoint?.content ?? null, batch);
      const preflight = await countChatPrompt({
        systemMessages: [SUMMARY_SYSTEM_PROMPT],
        history: [],
        request,
        reservedOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
      });
      assertContextFits(preflight);

      const response = await this.llm.respond(
        [{ role: "user", content: request }],
        signal,
        {
          systemMessages: [SUMMARY_SYSTEM_PROMPT],
          maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
        },
      );
      const completed = await consumeRequiredProviderResponse(response, this.now);
      const saved = this.store.saveConversationSummary(conversationId, {
        summarizedThroughMessageId: batch[batch.length - 1].id,
        summarizedMessageCount:
          (checkpoint?.summarizedMessageCount ?? 0) + batch.length,
        content: completed.text,
        model: this.llm.model,
        providerPromptTokens: completed.usage.promptTokens,
        providerCompletionTokens: completed.usage.completionTokens,
        costMicrosUsd: completed.metrics.costMicrosUsd,
      });
      createdCheckpoints.push(saved);
    }
  }
}

import "server-only";

import { ChatAgent, CHAT_SYSTEM_PROMPT, type ChatMessage } from "./chat-agent";
import { collectCompletedTextStream } from "./completed-text-stream";
import type { CompressionLlmResponder } from "./compression-llm";
import type { CompressionPreflight } from "./compression-types";
import {
  ConversationNotFoundError,
  getConversationStore,
  type SqliteConversationStore,
} from "./conversation-store";
import { buildSummarySystemMessage } from "./history-compression";
import { HistorySummarizer } from "./history-summarizer";
import { calculateDeepSeekCost } from "./token-cost";
import { assertContextFits, countChatPrompt, countTextTokens } from "./token-counter";

export type CompressedChatResponse = {
  stream: ReadableStream<Uint8Array>;
  preflight: CompressionPreflight;
};

export class CompressedChatAgent {
  constructor(
    private readonly store: SqliteConversationStore,
    private readonly llm: CompressionLlmResponder,
    private readonly summarizer: HistorySummarizer = new HistorySummarizer(store, llm),
    private readonly now: () => Date = () => new Date(),
  ) {}

  static fromEnvironment(
    store: SqliteConversationStore = getConversationStore(),
  ): CompressedChatAgent {
    const llm = ChatAgent.fromEnvironment();
    return new CompressedChatAgent(store, llm);
  }

  async respond(
    conversationId: string,
    content: string,
    signal: AbortSignal,
  ): Promise<CompressedChatResponse> {
    if (!this.store.getConversation(conversationId)) {
      throw new ConversationNotFoundError(conversationId);
    }

    const { checkpoint, rawTail } = await this.summarizer.prepare(
      conversationId,
      signal,
    );
    const fullHistory: ChatMessage[] = this.store
      .getMessages(conversationId)
      .map(({ role, content: savedContent }) => ({ role, content: savedContent }));
    const effectiveHistory = checkpoint ? rawTail : fullHistory;
    const systemMessages = checkpoint
      ? [CHAT_SYSTEM_PROMPT, buildSummarySystemMessage(checkpoint.content)]
      : [CHAT_SYSTEM_PROMPT];
    const [full, compressed] = await Promise.all([
      countChatPrompt({ history: fullHistory, request: content }),
      countChatPrompt({ systemMessages, history: effectiveHistory, request: content }),
    ]);
    assertContextFits(compressed);

    const summaryTokens = checkpoint
      ? compressed.systemTokens - full.systemTokens
      : 0;
    if (summaryTokens < 0) {
      throw new Error("Summary token breakdown нарушил монотонность.");
    }
    const preflight: CompressionPreflight = {
      full,
      compressed,
      summaryId: checkpoint?.id ?? null,
      summaryTokens,
      rawTailTokens: compressed.historyTokens,
      rawTailMessageCount: effectiveHistory.length,
      summarizedMessageCount: checkpoint?.summarizedMessageCount ?? 0,
      grossSavedTokens: full.promptTokens - compressed.promptTokens,
    };
    if (!checkpoint && preflight.grossSavedTokens !== 0) {
      throw new Error("Несжатая история изменила token count.");
    }

    const response = await this.llm.respond(
      [...effectiveHistory, { role: "user", content }],
      signal,
      { systemMessages },
    );
    const stream = collectCompletedTextStream(response.stream, async (assistantContent) => {
      const providerUsage = await response.usage;
      const responseTokens =
        providerUsage?.completionTokens ?? (await countTextTokens(assistantContent));
      const { tariffBand, costMicrosUsd } = calculateDeepSeekCost({
        promptTokens: providerUsage?.promptTokens ?? compressed.promptTokens,
        completionTokens: responseTokens,
        cacheHitTokens: providerUsage?.cacheHitTokens ?? null,
        cacheMissTokens: providerUsage?.cacheMissTokens ?? null,
        at: this.now(),
      });
      this.store.saveExchange(
        conversationId,
        content,
        assistantContent,
        {
          ...compressed,
          model: this.llm.model,
          responseTokens,
          providerUsage,
          source: providerUsage ? "provider" : "estimated",
          tariffBand,
          costMicrosUsd,
        },
        {
          summaryId: preflight.summaryId,
          rawTailMessageCount: preflight.rawTailMessageCount,
          fullPromptTokens: full.promptTokens,
          compressedPromptTokens: compressed.promptTokens,
          summaryTokens,
          rawTailTokens: preflight.rawTailTokens,
          grossSavedTokens: preflight.grossSavedTokens,
        },
      );
    });

    return { stream, preflight };
  }
}

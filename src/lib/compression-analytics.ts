import "server-only";

import type { ConversationCompressionAnalytics } from "./compression-types";
import {
  ConversationNotFoundError,
  type SqliteConversationStore,
} from "./conversation-store";

export function getConversationCompressionAnalytics(
  store: SqliteConversationStore,
  conversationId: string,
): ConversationCompressionAnalytics {
  if (!store.getConversation(conversationId)) {
    throw new ConversationNotFoundError(conversationId);
  }

  const summaries = store.getConversationSummaries(conversationId);
  const latestSummary = summaries.at(-1) ?? null;
  const pending = store.getMessagesAfter(
    conversationId,
    latestSummary?.summarizedThroughMessageId ?? null,
  );
  const exchanges = store.getConversationCompression(conversationId);
  const totals: ConversationCompressionAnalytics["totals"] = {
    fullPromptTokens: 0,
    compressedPromptTokens: 0,
    grossSavedTokens: 0,
    summaryPromptTokens: 0,
    summaryCompletionTokens: 0,
    summaryCostMicrosUsd: 0,
    compressedProviderPromptTokens: 0,
    compressedProviderCompletionTokens: 0,
    compressedCostMicrosUsd: 0,
    providerExchangeCount: 0,
    estimatedExchangeCount: 0,
  };

  for (const summary of summaries) {
    if (
      summary.providerPromptTokens === null ||
      summary.providerCompletionTokens === null
    ) {
      throw new Error("Summary checkpoint не содержит provider usage.");
    }
    totals.summaryPromptTokens += summary.providerPromptTokens;
    totals.summaryCompletionTokens += summary.providerCompletionTokens;
    totals.summaryCostMicrosUsd += summary.costMicrosUsd;
  }
  for (const exchange of exchanges) {
    totals.fullPromptTokens += exchange.fullPromptTokens;
    totals.compressedPromptTokens += exchange.compressedPromptTokens;
    totals.grossSavedTokens += exchange.grossSavedTokens;
    totals.compressedCostMicrosUsd += exchange.costMicrosUsd;
    if (
      exchange.providerPromptTokens !== null &&
      exchange.providerCompletionTokens !== null
    ) {
      totals.compressedProviderPromptTokens += exchange.providerPromptTokens;
      totals.compressedProviderCompletionTokens += exchange.providerCompletionTokens;
    }
    if (exchange.source === "provider") totals.providerExchangeCount += 1;
    else totals.estimatedExchangeCount += 1;
  }

  return {
    latestSummary,
    summarizedMessageCount: latestSummary?.summarizedMessageCount ?? 0,
    rawTailMessageCount: pending.length,
    exchanges,
    totals,
  };
}

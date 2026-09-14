import "server-only";

import { ChatAgentError, type ChatMessage } from "./chat-agent";
import type {
  BenchmarkCallMetrics,
} from "./compression-types";
import type {
  ChatAgentResponse,
  ChatRequestOptions,
  ProviderTokenUsage,
} from "./conversation-types";
import { calculateDeepSeekCost } from "./token-cost";

export type CompressionLlmResponder = {
  readonly model: string;
  respond(
    messages: readonly ChatMessage[],
    signal: AbortSignal,
    options?: ChatRequestOptions,
  ): Promise<ChatAgentResponse>;
};

export type RequiredProviderResponse = {
  text: string;
  usage: ProviderTokenUsage;
  metrics: BenchmarkCallMetrics;
};

export async function consumeRequiredProviderResponse(
  response: ChatAgentResponse,
  now: () => Date = () => new Date(),
): Promise<RequiredProviderResponse> {
  const text = (await new Response(response.stream).text()).trim();
  if (!text) throw new ChatAgentError("API вернул пустой ответ.", "upstream");

  const usage = await response.usage;
  if (!usage) {
    throw new ChatAgentError("API не вернул корректный provider usage.", "upstream");
  }
  const { costMicrosUsd } = calculateDeepSeekCost({
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    cacheHitTokens: usage.cacheHitTokens,
    cacheMissTokens: usage.cacheMissTokens,
    at: now(),
  });

  return {
    text,
    usage,
    metrics: {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      costMicrosUsd,
    },
  };
}

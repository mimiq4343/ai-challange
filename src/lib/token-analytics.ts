import type { ChatMessage } from "./chat-agent";
import {
  ConversationNotFoundError,
  type SqliteConversationStore,
} from "./conversation-store";
import type {
  ComparisonScenario,
  ConversationUsageAnalytics,
  ConversationUsagePoint,
  StoredExchangeUsage,
  TokenComparisonResponse,
} from "./conversation-types";
import { DEEPSEEK_FLASH_PROFILE } from "./model-profiles";
import { calculateDeepSeekCost } from "./token-cost";
import { countChatPrompt, countTextTokens } from "./token-counter";

async function estimateLegacyUsage(input: {
  conversationId: string;
  assistantMessageId: number;
  createdAt: string;
  history: ChatMessage[];
  request: string;
  response: string;
}): Promise<StoredExchangeUsage> {
  const breakdown = await countChatPrompt({
    history: input.history,
    request: input.request,
  });
  const responseTokens = await countTextTokens(input.response);
  const { tariffBand, costMicrosUsd } = calculateDeepSeekCost({
    promptTokens: breakdown.promptTokens,
    completionTokens: responseTokens,
    cacheHitTokens: null,
    cacheMissTokens: null,
    at: new Date(input.createdAt),
  });

  return {
    ...breakdown,
    id: -input.assistantMessageId,
    conversationId: input.conversationId,
    assistantMessageId: input.assistantMessageId,
    model: DEEPSEEK_FLASH_PROFILE.acceptedIds[0],
    responseTokens,
    providerPromptTokens: null,
    providerCompletionTokens: null,
    cacheHitTokens: null,
    cacheMissTokens: null,
    source: "estimated",
    tariffBand,
    costMicrosUsd,
    createdAt: input.createdAt,
  };
}

export async function getConversationAnalytics(
  store: SqliteConversationStore,
  conversationId: string,
): Promise<ConversationUsageAnalytics> {
  if (!store.getConversation(conversationId)) {
    throw new ConversationNotFoundError(conversationId);
  }

  const messages = store.getMessages(conversationId);
  const storedUsage = store.getConversationUsage(conversationId);
  const usageByAssistantId = new Map(
    storedUsage.map((usage) => [usage.assistantMessageId, usage]),
  );
  const exchanges: StoredExchangeUsage[] = [];
  const history: ChatMessage[] = [];

  for (let index = 0; index + 1 < messages.length; index += 2) {
    const userMessage = messages[index];
    const assistantMessage = messages[index + 1];
    if (userMessage.role !== "user" || assistantMessage.role !== "assistant") break;

    const usage =
      usageByAssistantId.get(assistantMessage.id) ??
      (await estimateLegacyUsage({
        conversationId,
        assistantMessageId: assistantMessage.id,
        createdAt: assistantMessage.createdAt,
        history,
        request: userMessage.content,
        response: assistantMessage.content,
      }));
    exchanges.push(usage);
    history.push(
      { role: "user", content: userMessage.content },
      { role: "assistant", content: assistantMessage.content },
    );
  }

  let cumulativePromptTokens = 0;
  let cumulativeResponseTokens = 0;
  let cumulativeCostMicrosUsd = 0;
  const points: ConversationUsagePoint[] = exchanges.map((exchange) => {
    cumulativePromptTokens += exchange.providerPromptTokens ?? exchange.promptTokens;
    cumulativeResponseTokens +=
      exchange.providerCompletionTokens ?? exchange.responseTokens;
    cumulativeCostMicrosUsd += exchange.costMicrosUsd;
    return {
      ...exchange,
      cumulativePromptTokens,
      cumulativeResponseTokens,
      cumulativeCostMicrosUsd,
    };
  });

  return {
    conversationId,
    contextLimit: points.at(-1)?.contextLimit ?? DEEPSEEK_FLASH_PROFILE.contextWindow,
    exchanges: points,
    totals: {
      promptTokens: cumulativePromptTokens,
      responseTokens: cumulativeResponseTokens,
      costMicrosUsd: cumulativeCostMicrosUsd,
    },
  };
}

async function estimateComparisonScenario(
  id: ComparisonScenario["id"],
  label: string,
  history: ChatMessage[],
  request: string,
  response: string,
): Promise<ComparisonScenario> {
  const breakdown = await countChatPrompt({ history, request });
  const responseTokens = await countTextTokens(response);
  const { costMicrosUsd } = calculateDeepSeekCost({
    promptTokens: breakdown.promptTokens,
    completionTokens: responseTokens,
    cacheHitTokens: null,
    cacheMissTokens: null,
    at: new Date(),
  });

  return {
    id,
    label,
    requestTokens: breakdown.requestTokens,
    historyTokens: breakdown.historyTokens,
    responseTokens,
    totalTokens: breakdown.promptTokens + responseTokens,
    contextTokens: breakdown.contextTokens,
    contextLimit: breakdown.contextLimit,
    costMicrosUsd,
    source: "estimated",
  };
}

export async function getComparisonScenarios(
  store: SqliteConversationStore,
): Promise<TokenComparisonResponse> {
  const request = "Сформулируй итог проекта в трёх пунктах.";
  const response = "Итог: требования выполнены, риски измерены, следующий шаг определён.";
  const longHistory: ChatMessage[] = [];
  for (let index = 1; index <= 20; index += 1) {
    longHistory.push(
      {
        role: "user",
        content: `Шаг ${index}: уточни ограничение, зависимость и критерий проверки.`,
      },
      {
        role: "assistant",
        content: `Для шага ${index} фиксирую ограничение, проверяемую зависимость и наблюдаемый результат.`,
      },
    );
  }

  const [shortScenario, longScenario] = await Promise.all([
    estimateComparisonScenario("short", "Короткий", [], request, response),
    estimateComparisonScenario("long", "Длинный", longHistory, request, response),
  ]);

  return {
    scenarios: [shortScenario, longScenario],
    latestOverflowRun: store.getLatestOverflowRun(),
  };
}

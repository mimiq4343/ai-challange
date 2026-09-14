import "server-only";

import { ChatAgent, CHAT_SYSTEM_PROMPT, type ChatMessage } from "./chat-agent";
import { collectCompletedTextStream } from "./completed-text-stream";
import { consumeRequiredProviderResponse, type CompressionLlmResponder } from "./compression-llm";
import {
  buildFactsSystemMessage,
  buildFactsUpdateRequest,
  EMPTY_STICKY_FACTS,
  FACTS_EXTRACTOR_SYSTEM_PROMPT,
  FACTS_MAX_OUTPUT_TOKENS,
  parseStickyFacts,
} from "./context-strategy-policy";
import {
  getContextStrategyStore,
  type SqliteContextStrategyStore,
} from "./context-strategy-store";
import type { StickyFacts } from "./context-strategy-types";
import type { TokenBreakdown } from "./conversation-types";
import { calculateDeepSeekCost } from "./token-cost";
import {
  assertContextFits,
  countChatPrompt,
  countTextTokens,
} from "./token-counter";

export type ContextStrategyResponse = {
  stream: ReadableStream<Uint8Array>;
  preflight: TokenBreakdown;
  factsOverheadTokens: number;
};

export class ContextStrategyAgent {
  constructor(
    private readonly store: SqliteContextStrategyStore,
    private readonly llm: CompressionLlmResponder,
  ) {}

  static fromEnvironment(
    store: SqliteContextStrategyStore = getContextStrategyStore(),
  ): ContextStrategyAgent {
    return new ContextStrategyAgent(store, ChatAgent.fromEnvironment());
  }

  async respond(
    sessionId: string,
    content: string,
    signal: AbortSignal,
  ): Promise<ContextStrategyResponse> {
    const session = this.store.requireSession(sessionId);
    const history: ChatMessage[] = this.store
      .getPromptMessages(sessionId)
      .map(({ role, content: messageContent }) => ({
        role,
        content: messageContent,
      }));

    let nextFacts: StickyFacts | undefined;
    let factsOverheadTokens = 0;
    if (session.strategy === "facts") {
      const factsResponse = await this.llm.respond(
        [
          {
            role: "user",
            content: buildFactsUpdateRequest(
              session.facts ?? EMPTY_STICKY_FACTS,
              content,
            ),
          },
        ],
        signal,
        {
          systemMessages: [FACTS_EXTRACTOR_SYSTEM_PROMPT],
          maxOutputTokens: FACTS_MAX_OUTPUT_TOKENS,
        },
      );
      const completedFacts = await consumeRequiredProviderResponse(factsResponse);
      nextFacts = parseStickyFacts(completedFacts.text);
      factsOverheadTokens = completedFacts.usage.totalTokens;
    }

    const systemMessages = [CHAT_SYSTEM_PROMPT];
    if (nextFacts) systemMessages.push(buildFactsSystemMessage(nextFacts));
    const preflight = await countChatPrompt({
      systemMessages,
      history,
      request: content,
    });
    assertContextFits(preflight);

    const response = await this.llm.respond(
      [...history, { role: "user", content }],
      signal,
      { systemMessages },
    );
    const stream = collectCompletedTextStream(
      response.stream,
      async (assistantContent) => {
        const providerUsage = await response.usage;
        const completionTokens =
          providerUsage?.completionTokens ??
          (await countTextTokens(assistantContent));
        const { costMicrosUsd } = calculateDeepSeekCost({
          promptTokens: providerUsage?.promptTokens ?? preflight.promptTokens,
          completionTokens,
          cacheHitTokens: providerUsage?.cacheHitTokens ?? null,
          cacheMissTokens: providerUsage?.cacheMissTokens ?? null,
          at: new Date(),
        });
        this.store.saveExchange(
          sessionId,
          content,
          assistantContent,
          {
            preflight,
            providerUsage,
            completionTokens,
            costMicrosUsd,
          },
          nextFacts,
        );
      },
    );

    return { stream, preflight, factsOverheadTokens };
  }
}

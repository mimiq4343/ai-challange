import { ChatAgent, ChatAgentError, type ChatMessage } from "./chat-agent";
import {
  ConversationNotFoundError,
  getConversationStore,
  type SqliteConversationStore,
} from "./conversation-store";
import type {
  ChatAgentResponse,
  ChatRequestOptions,
  ProviderTokenUsage,
} from "./conversation-types";
import {
  composeMemoryPrompt,
  countMemoryPromptTokens,
  SHORT_TERM_WINDOW_MESSAGES,
} from "./memory-composer";
import { runMemoryRouter } from "./memory-router";
import { ProviderMemoryRouterLlm, type MemoryRouterLlm } from "./memory-router-llm";
import { getMemoryStore, type SqliteMemoryStore } from "./memory-store";
import type {
  ConversationMemorySnapshot,
  MemoryLayerTokens,
  MemoryLayerToggles,
  MemoryRouterResult,
  WorkingMemory,
} from "./memory-types";
import { getProfileStore, type SqliteProfileStore } from "./profile-store";
import type { ProfileRouterWrite, UserProfile } from "./profile-types";
import { calculateDeepSeekCost } from "./token-cost";
import { assertContextFits, countTextTokens } from "./token-counter";

type LlmResponder = {
  readonly model: string;
  respond(
    messages: readonly ChatMessage[],
    signal: AbortSignal,
    options?: ChatRequestOptions,
  ): Promise<ChatAgentResponse>;
};

export type PersonalizedChatResponse = {
  stream: ReadableStream<Uint8Array>;
  layerTokens: MemoryLayerTokens;
  shortTermMessages: number;
  profile: UserProfile;
};

export type PersonalizedMemorySnapshot = ConversationMemorySnapshot & {
  profile: UserProfile;
};

export class PersonalizedChatAgent {
  constructor(
    private readonly store: SqliteConversationStore,
    private readonly memory: SqliteMemoryStore,
    private readonly profiles: SqliteProfileStore,
    private readonly llm: LlmResponder,
    private readonly router: MemoryRouterLlm | null,
  ) {}

  static fromEnvironment(
    store: SqliteConversationStore = getConversationStore(),
    memory: SqliteMemoryStore = getMemoryStore(),
    profiles: SqliteProfileStore = getProfileStore(),
  ): PersonalizedChatAgent {
    return new PersonalizedChatAgent(
      store,
      memory,
      profiles,
      ChatAgent.fromEnvironment(),
      ProviderMemoryRouterLlm.fromEnvironment(),
    );
  }

  getSnapshot(conversationId: string): PersonalizedMemorySnapshot {
    const profile = this.profiles.getActiveProfile();
    const messages = this.store.getMessages(conversationId);
    return {
      ...this.memory.getSnapshot(conversationId, profile.id, {
        windowMessages: SHORT_TERM_WINDOW_MESSAGES,
        totalMessages: messages.length,
        includedMessages: Math.min(messages.length, SHORT_TERM_WINDOW_MESSAGES),
      }),
      profile,
    };
  }

  async respond(
    conversationId: string,
    content: string,
    layers: MemoryLayerToggles,
    signal: AbortSignal,
  ): Promise<PersonalizedChatResponse> {
    if (!this.store.getConversation(conversationId)) {
      throw new ConversationNotFoundError(conversationId);
    }

    const profile = this.profiles.getActiveProfile();
    const working = this.memory.getWorkingMemory(conversationId);
    const composed = await composeMemoryPrompt({
      messages: this.store.getMessages(conversationId),
      profile,
      longTerm: this.memory.listLongTerm(profile.id),
      working,
      layers,
    });
    const layerTokens = await countMemoryPromptTokens({ composed, request: content });
    assertContextFits({
      systemTokens: layerTokens.systemTokens,
      historyTokens: layerTokens.shortTermTokens,
      requestTokens: layerTokens.requestTokens,
      promptTokens: layerTokens.promptTokens,
      reservedOutputTokens: layerTokens.reservedOutputTokens,
      contextTokens: layerTokens.contextTokens,
      contextLimit: layerTokens.contextLimit,
    });

    const response = await this.llm.respond(
      [...composed.history, { role: "user", content }],
      signal,
      { systemMessages: composed.systemMessages },
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

          await this.persistExchange({
            conversationId,
            profile,
            request: content,
            assistantContent,
            layers,
            layerTokens,
            shortTermMessages: composed.shortTermMessages,
            providerUsage: await response.usage,
            working,
          });
        },
      }),
    );

    return {
      stream,
      layerTokens,
      shortTermMessages: composed.shortTermMessages,
      profile,
    };
  }

  private async persistExchange(input: {
    conversationId: string;
    profile: UserProfile;
    request: string;
    assistantContent: string;
    layers: MemoryLayerToggles;
    layerTokens: MemoryLayerTokens;
    shortTermMessages: number;
    providerUsage: ProviderTokenUsage | null;
    working: WorkingMemory | null;
  }): Promise<void> {
    const responseTokens =
      input.providerUsage?.completionTokens ??
      (await countTextTokens(input.assistantContent));
    const { tariffBand, costMicrosUsd } = calculateDeepSeekCost({
      promptTokens: input.providerUsage?.promptTokens ?? input.layerTokens.promptTokens,
      completionTokens: responseTokens,
      cacheHitTokens: input.providerUsage?.cacheHitTokens ?? null,
      cacheMissTokens: input.providerUsage?.cacheMissTokens ?? null,
      at: new Date(),
    });

    this.store.saveExchange(input.conversationId, input.request, input.assistantContent, {
      systemTokens: input.layerTokens.systemTokens,
      historyTokens:
        input.layerTokens.shortTermTokens +
        input.layerTokens.longTermTokens +
        input.layerTokens.workingTokens +
        input.layerTokens.profileTokens,
      requestTokens: input.layerTokens.requestTokens,
      promptTokens: input.layerTokens.promptTokens,
      reservedOutputTokens: input.layerTokens.reservedOutputTokens,
      contextTokens: input.layerTokens.contextTokens,
      contextLimit: input.layerTokens.contextLimit,
      model: this.llm.model,
      responseTokens,
      providerUsage: input.providerUsage,
      source: input.providerUsage ? "provider" : "estimated",
      tariffBand,
      costMicrosUsd,
    });

    const assistantMessageId = this.store.getMessages(input.conversationId).at(-1)?.id;
    if (assistantMessageId === undefined) return;

    const routerResult = await this.route({
      conversationId: input.conversationId,
      profile: input.profile,
      request: input.request,
      assistantContent: input.assistantContent,
      working: input.working,
    });

    this.memory.saveExchangeMemoryUsage(input.conversationId, assistantMessageId, {
      ...input.layerTokens,
      layers: input.layers,
      shortTermMessages: input.shortTermMessages,
      router: routerResult?.cost ?? null,
    });

    if (!routerResult) return;

    this.memory.applyRouterResult(
      input.conversationId,
      assistantMessageId,
      input.profile.id,
      routerResult,
    );
    const profileWrites = routerResult.writes.filter(
      (write): write is ProfileRouterWrite => write.layer === "profile",
    );
    this.profiles.applyProfileWrites(input.profile.id, profileWrites, {
      conversationId: input.conversationId,
      assistantMessageId,
    });
  }

  /**
   * Роутер памяти не влияет на уже сохранённый обмен: его сбой логируется один
   * раз и оставляет слои без новых записей.
   */
  private async route(input: {
    conversationId: string;
    profile: UserProfile;
    request: string;
    assistantContent: string;
    working: WorkingMemory | null;
  }): Promise<MemoryRouterResult | null> {
    if (!this.router) return null;

    try {
      return await runMemoryRouter({
        llm: this.router,
        request: input.request,
        response: input.assistantContent,
        working: input.working,
        longTermKeys: this.memory
          .listLongTerm(input.profile.id)
          .map((entry) => entry.key),
        profile: input.profile,
      });
    } catch (error) {
      console.error(
        `Роутер памяти не смог разобрать обмен диалога ${input.conversationId}.`,
        error,
      );
      return null;
    }
  }
}

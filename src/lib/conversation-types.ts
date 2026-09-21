export type MessageRole = "user" | "assistant";

export type ConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type StoredMessage = {
  id: number;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
};

export type ConversationDetail = {
  conversation: ConversationSummary;
  messages: StoredMessage[];
};

export type TokenSource = "provider" | "estimated";

export type TariffBand = "peak" | "off-peak";

export type TokenBreakdown = {
  systemTokens: number;
  historyTokens: number;
  requestTokens: number;
  promptTokens: number;
  reservedOutputTokens: number;
  contextTokens: number;
  contextLimit: number;
};

export type ProviderTokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheHitTokens: number | null;
  cacheMissTokens: number | null;
};

export type ChatAgentResponse = {
  stream: ReadableStream<Uint8Array>;
  usage: Promise<ProviderTokenUsage | null>;
  /** `length` означает, что лимит вывода исчерпан — у reasoning-модели ещё до ответа. */
  finishReason?: Promise<string | null>;
};

export type ChatRequestOptions = {
  systemMessages?: readonly string[];
  maxOutputTokens?: number;
};

export type ExchangeUsageInput = TokenBreakdown & {
  model: string;
  responseTokens: number;
  providerUsage: ProviderTokenUsage | null;
  source: TokenSource;
  tariffBand: TariffBand;
  costMicrosUsd: number;
};

export type StoredExchangeUsage = TokenBreakdown & {
  id: number;
  conversationId: string;
  assistantMessageId: number;
  model: string;
  responseTokens: number;
  providerPromptTokens: number | null;
  providerCompletionTokens: number | null;
  cacheHitTokens: number | null;
  cacheMissTokens: number | null;
  source: TokenSource;
  tariffBand: TariffBand;
  costMicrosUsd: number;
  createdAt: string;
};

export type ConversationUsagePoint = StoredExchangeUsage & {
  cumulativePromptTokens: number;
  cumulativeResponseTokens: number;
  cumulativeCostMicrosUsd: number;
};

export type ConversationUsageAnalytics = {
  conversationId: string;
  contextLimit: number;
  exchanges: ConversationUsagePoint[];
  totals: {
    promptTokens: number;
    responseTokens: number;
    costMicrosUsd: number;
  };
};

export type ComparisonScenario = {
  id: "short" | "long";
  label: string;
  requestTokens: number;
  historyTokens: number;
  responseTokens: number;
  totalTokens: number;
  contextTokens: number;
  contextLimit: number;
  costMicrosUsd: number;
  source: "estimated";
};

export type OverflowOutcome = "rejected" | "truncated" | "accepted" | "network_error";

export type OverflowRunInput = {
  model: string;
  contextLimit: number;
  localInputTokens: number;
  providerInputTokens: number | null;
  outcome: OverflowOutcome;
  httpStatus: number | null;
  errorMessage: string | null;
  durationMs: number;
  costMicrosUsd: number;
};

export type OverflowRun = OverflowRunInput & {
  id: number;
  createdAt: string;
};

export type TokenComparisonResponse = {
  scenarios: ComparisonScenario[];
  latestOverflowRun: OverflowRun | null;
};

export type ContextLimitPayload = {
  error: "context_limit";
  limit: number;
  system: number;
  history: number;
  request: number;
  reservedOutput: number;
  total: number;
  overflow: number;
};

import type { TokenBreakdown, TokenSource } from "./conversation-types";

export type SummaryCheckpoint = {
  id: number;
  conversationId: string;
  summarizedThroughMessageId: number;
  summarizedMessageCount: number;
  content: string;
  model: string;
  providerPromptTokens: number | null;
  providerCompletionTokens: number | null;
  costMicrosUsd: number;
  createdAt: string;
};

export type SummaryCheckpointInput = Omit<
  SummaryCheckpoint,
  "id" | "conversationId" | "createdAt"
>;

export type ExchangeCompressionInput = {
  summaryId: number | null;
  rawTailMessageCount: number;
  fullPromptTokens: number;
  compressedPromptTokens: number;
  summaryTokens: number;
  rawTailTokens: number;
  grossSavedTokens: number;
};

export type StoredExchangeCompression = ExchangeCompressionInput & {
  assistantMessageId: number;
  requestTokens: number;
  responseTokens: number;
  conversationId: string;
  providerPromptTokens: number | null;
  providerCompletionTokens: number | null;
  source: TokenSource;
  costMicrosUsd: number;
  createdAt: string;
};

export type CompressionPreflight = {
  full: TokenBreakdown;
  compressed: TokenBreakdown;
  summaryId: number | null;
  summaryTokens: number;
  rawTailTokens: number;
  rawTailMessageCount: number;
  summarizedMessageCount: number;
  grossSavedTokens: number;
};

export type CompressionHeaderPreview = {
  fullPromptTokens: number;
  compressedPromptTokens: number;
  summaryTokens: number;
  rawTailTokens: number;
  effectiveHistoryTokens: number;
  grossSavedTokens: number;
  rawTailMessageCount: number;
  summarizedMessageCount: number;
};

export type ConversationCompressionAnalytics = {
  latestSummary: SummaryCheckpoint | null;
  summarizedMessageCount: number;
  rawTailMessageCount: number;
  exchanges: StoredExchangeCompression[];
  totals: {
    fullPromptTokens: number;
    compressedPromptTokens: number;
    grossSavedTokens: number;
    summaryPromptTokens: number;
    summaryCompletionTokens: number;
    summaryCostMicrosUsd: number;
    compressedProviderPromptTokens: number;
    compressedProviderCompletionTokens: number;
    compressedCostMicrosUsd: number;
    providerExchangeCount: number;
    estimatedExchangeCount: number;
  };
};

export type BenchmarkCallMetrics = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costMicrosUsd: number;
};

export type JudgeScores = {
  factualAccuracy: number;
  completeness: number;
  instructionFollowing: number;
  overall: number;
};

export type BlindJudgeResult = {
  a: JudgeScores;
  b: JudgeScores;
  winner: "a" | "b" | "tie";
  rationale: string;
};

export type BenchmarkVariant = "full" | "compressed";

export type CompressionRunInput = {
  model: string;
  summary: string;
  fullAnswer: string;
  compressedAnswer: string;
  labelA: BenchmarkVariant;
  judge: BlindJudgeResult;
  calls: {
    summary: BenchmarkCallMetrics;
    full: BenchmarkCallMetrics;
    compressed: BenchmarkCallMetrics;
    judge: BenchmarkCallMetrics;
  };
  grossSavedTokens: number;
  summaryOverheadTokens: number;
  netSavedTokens: number;
};

export type CompressionRun = CompressionRunInput & {
  id: number;
  createdAt: string;
};

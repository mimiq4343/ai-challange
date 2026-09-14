import type { MessageRole, ProviderTokenUsage, TokenBreakdown } from "./conversation-types";

export type ContextStrategy = "sliding" | "facts" | "branching";

export type StickyFacts = {
  goal: string;
  constraints: string[];
  preferences: string[];
  decisions: string[];
  agreements: string[];
};

export type ContextSession = {
  id: string;
  strategy: ContextStrategy;
  title: string;
  facts: StickyFacts | null;
  activeBranchId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ContextStoredMessage = {
  id: number;
  sessionId: string;
  branchId: string | null;
  role: MessageRole;
  content: string;
  promptTokens: number | null;
  completionTokens: number | null;
  costMicrosUsd: number | null;
  createdAt: string;
};

export type ContextCheckpoint = {
  id: string;
  sessionId: string;
  messageId: number;
  createdAt: string;
};

export type ContextBranch = {
  id: string;
  sessionId: string;
  checkpointId: string;
  name: string;
  createdAt: string;
};

export type ContextSessionDetail = {
  session: ContextSession;
  messages: ContextStoredMessage[];
  checkpoint: ContextCheckpoint | null;
  branches: ContextBranch[];
  retainedMessageCount: number;
  totals: {
    promptTokens: number;
    completionTokens: number;
    costMicrosUsd: number;
  };
};

export type ContextExchangeMetrics = {
  preflight: TokenBreakdown;
  providerUsage: ProviderTokenUsage | null;
  completionTokens: number;
  costMicrosUsd: number;
};

export type BenchmarkStrategyResult = {
  strategy: ContextStrategy;
  answer: string;
  promptTokens: number;
  completionTokens: number;
  overheadTokens: number;
  costMicrosUsd: number;
  qualityScore: number;
  stabilityScore: number;
  retainedFacts: string[];
  missingFacts: string[];
  usability: string;
};

export type ContextBenchmarkRun = {
  id: number;
  model: string;
  results: BenchmarkStrategyResult[];
  createdAt: string;
};

export type ContextBenchmarkRunInput = Omit<ContextBenchmarkRun, "id" | "createdAt">;

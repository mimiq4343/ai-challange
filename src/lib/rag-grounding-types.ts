import type { ProviderTokenUsage } from "./conversation-types";
import type { RefinementAnswer, RefinementQuestion, RefinementSettings } from "./rag-refinement-types";

export type GroundedQuote = { sourceId: string; chunkId: string; text: string };
export type GroundedAnswer = RefinementAnswer & {
  status: "answered" | "unknown";
  clarification: string | null;
  quotes: GroundedQuote[];
};
export type GroundingJudgement = {
  supported: boolean;
  rationale: string;
  unsupportedClaims: string[];
  usage: ProviderTokenUsage;
};
export type GroundingBenchmarkCase = {
  question: RefinementQuestion;
  answer: GroundedAnswer;
  checks: { hasSources: boolean; hasQuotes: boolean; verbatimQuotes: boolean; retrievalHit: boolean | null; validUnknown: boolean; supported: boolean };
  judge: GroundingJudgement;
  usage: ProviderTokenUsage;
};
export type GroundingBenchmarkReport = {
  version: 1;
  createdAt: string;
  model: string;
  indexId: string;
  corpusHash: string;
  embeddingModel: string;
  settings: RefinementSettings;
  prompts: { rewrite: string; rerank: string; answer: string; judge: string };
  cases: GroundingBenchmarkCase[];
};

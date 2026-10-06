import type { JudgeScores } from "./compression-types";
import type { ProviderTokenUsage } from "./conversation-types";
import type { RagAnswer, RagQuestion, RagSource } from "./rag-types";

export type RefinementMode = "baseline" | "rewrite" | "refined";
export type RefinementRequestMode = RefinementMode | "compare";
export type RefinementSettings = { candidateK: number; contextK: number; minRelevance: number };
export type RefinementStage = { id: string; kind: "rewrite" | "rerank"; usage: ProviderTokenUsage; durationMs: number };
export type RefinementCandidate = {
  source: RagSource;
  relevance: number | null;
  reason: string | null;
  decision: "selected" | "below_threshold" | "outside_top_k";
};
export type RefinementAnswer = {
  mode: RefinementMode;
  query: string;
  settings: RefinementSettings;
  result: RagAnswer;
  candidates: RefinementCandidate[];
  stages: RefinementStage[];
  usage: ProviderTokenUsage;
  durationMs: number;
};
export type RefinementQuestion = Omit<RagQuestion, "source" | "section" | "evidence"> & {
  source: string | null;
  section: string | null;
  evidence: string | null;
};
export type RefinementJudgement = {
  scores: Record<RefinementMode, JudgeScores>;
  winner: RefinementMode | "tie";
  rationale: string;
  labels: Record<"a" | "b" | "c", RefinementMode>;
  usage: ProviderTokenUsage;
};
export type RefinementBenchmarkCase = {
  question: RefinementQuestion;
  answers: RefinementAnswer[];
  retrievalHits: Record<RefinementMode, boolean | null>;
  judge: RefinementJudgement;
  usage: ProviderTokenUsage;
};
export type RefinementBenchmarkReport = {
  version: 1;
  createdAt: string;
  model: string;
  indexId: string;
  corpusHash: string;
  embeddingModel: string;
  settings: RefinementSettings;
  prompts: { rewrite: string; rerank: string; answer: string; judge: string };
  cases: RefinementBenchmarkCase[];
};

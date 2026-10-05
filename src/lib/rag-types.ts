import type { ProviderTokenUsage } from "./conversation-types";
import type { DocumentChunk } from "./document-types";
import type { BlindJudgeResult } from "./compression-types";

export type RagMode = "plain" | "rag";
export type RagRequestMode = RagMode | "compare";
export type RagSource = DocumentChunk & { id: string; score: number };
export type RagAnswer = {
  mode: RagMode;
  question: string;
  answer: string;
  model: string;
  indexId: string | null;
  sources: RagSource[];
  citations: string[];
  invalidCitations: string[];
  usage: ProviderTokenUsage;
  embeddingTokens: number;
  retrievalMs: number;
  generationMs: number;
  durationMs: number;
};
export type RagQuestion = {
  id: string;
  question: string;
  expectedFacts: string[];
  source: string;
  section: string;
  evidence: string;
};
export type RagBenchmarkCase = {
  question: RagQuestion;
  plain: RagAnswer;
  rag: RagAnswer;
  retrievalHit: boolean;
  labelA: RagMode;
  judge: BlindJudgeResult;
  judgeUsage: ProviderTokenUsage;
};
export type RagBenchmarkReport = {
  version: 1;
  createdAt: string;
  model: string;
  indexId: string;
  corpusHash: string;
  embeddingModel: string;
  strategy: "structural";
  settings: { topK: number; maxOutputTokens: number; answerPrompt: string; judgePrompt: string };
  cases: RagBenchmarkCase[];
};

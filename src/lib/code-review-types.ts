import type { DocumentChunk } from "./document-types";

export type ReviewFile = {
  path: string;
  previousPath?: string;
  status: string;
  side: "head" | "base";
  content: string;
  patch: string;
  changedLines: number[];
};

export type ReviewSnapshot = {
  baseSha: string;
  headSha: string;
  mergeBaseSha: string;
  totalFiles: number;
  files: ReviewFile[];
  skipped: { path: string; reason: string }[];
};

export type ReviewSource = Pick<DocumentChunk, "source" | "section" | "startLine" | "endLine" | "text"> & {
  id: string;
  score: number;
};

export type ReviewFinding = {
  category: "bug" | "architecture" | "recommendation";
  severity: "high" | "medium" | "low";
  line: number | null;
  title: string;
  body: string;
  recommendation: string;
  sourceIds: string[];
};

export type FileReview = {
  path: string;
  side: "base" | "head";
  findings: ReviewFinding[];
  limitations: string[];
  sources: ReviewSource[];
};

export type CodeReviewReport = {
  model: string;
  indexId: string | null;
  snapshot: ReviewSnapshot;
  reviews: FileReview[];
};

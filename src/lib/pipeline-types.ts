import type { GitHubRepositoryInfo } from "./github-repository-tool";

export type PipelineSearchResult = {
  searchResultId: string;
  query: string;
  repositories: GitHubRepositoryInfo[];
  createdAt: string;
};

export type PipelineSummary = {
  summaryId: string;
  searchResultId: string;
  markdown: string;
  createdAt: string;
};

export type PipelineReport = {
  reportId: string;
  summaryId: string;
  searchResultId: string;
  query: string;
  fileName: string;
  downloadUrl: string;
  createdAt: string;
};

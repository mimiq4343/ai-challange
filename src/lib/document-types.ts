export type ChunkStrategy = "fixed" | "structural";

export type CorpusDocument = {
  source: string;
  title: string;
  text: string;
  sourceHash: string;
};

export type DocumentCorpus = {
  documents: CorpusDocument[];
  hash: string;
  characters: number;
  lines: number;
  estimatedPages: number;
  charactersPerPage: number;
};

export type DocumentSection = { title: string; start: number; end: number };

export type DocumentChunk = {
  chunkId: string;
  strategy: ChunkStrategy;
  source: string;
  title: string;
  section: string;
  text: string;
  sourceHash: string;
  contentHash: string;
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  tokenCount: number;
  boundaryCrossings: number;
};

export type EmbeddedChunk = DocumentChunk & { embedding: number[] };

export type RetrievalQuestion = {
  id: string;
  question: string;
  source: string;
  section: string;
  evidence: string;
};

export type RetrievalResult = {
  questionId: string;
  question: string;
  expectedSource: string;
  expectedSection: string;
  expectedEvidence: string;
  rank: number | null;
  hits: { chunkId: string; source: string; section: string; score: number; relevant: boolean }[];
};

export type StrategyComparison = {
  strategy: ChunkStrategy;
  chunks: number;
  tokens: { min: number; max: number; mean: number; total: number };
  boundaryCrossingChunks: number;
  embeddingMs: number;
  vectorBytes: number;
  hitRateAt5: number;
  mrrAt5: number;
  retrieval: RetrievalResult[];
};

export type DocumentIndexReport = {
  id: string;
  createdAt: string;
  model: string;
  dimensions: number;
  corpus: Omit<DocumentCorpus, "documents"> & { files: number };
  chunking: { maxTokens: number; overlapTokens: number };
  providerRequests: number;
  providerTokens: number;
  comparison: StrategyComparison[];
};

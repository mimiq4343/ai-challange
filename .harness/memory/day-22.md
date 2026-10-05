# Day 22: RAG agent and comparison

Snapshot: 2026-10-05.

- The user requires arbitrary questions, a RAG toggle, side-by-side answers and a
  single button running all ten prepared questions. `/day-22`, `/api/rag` and the
  NDJSON benchmark endpoint implement these flows. Requests have no conversation
  history; both modes use the same system prompt and generation settings.
- After OpenRouter exhausted its free embedding quota, the user explicitly asked
  to change the embedding model. Do not confuse this with changing the response
  LLM or coding agent. Day 22 now uses pinned local `Xenova/multilingual-e5-small`
  through the installed Transformers.js, CPU/q8, mean pooling, normalized 384-D
  vectors, `query: ` / `passage: ` prefixes. `npm run rag:index` downloads public
  model files with SHA-256 checks and reuses the document indexer with an explicit
  E5 configuration and tokenizer. Day 21 keeps its Nemotron index and route.
- Local artifacts are ignored: model weights, `data/rag-documents.sqlite`, index
  comparison and complete RAG benchmark JSON. SQLite snapshots bind report and
  vectors to one index; benchmark failures/cancellation preserve the saved report.
- Ten questions have expectations, source, section and evidence in
  [`rag-questions.json`](../../src/lib/rag-questions.json). Only the blind judge
  receives expectations. No reference injection after a retrieval miss.
- Measured browser run: mean overall score 1.2 without RAG, 7.8 with RAG; expected
  evidence found in 7/10. The same LLM judges, so scores are indicative only. E5
  missed history/stream implementation and MCP authorization; function chunks
  also lack separate compression constants. See the full
  [quality report](../reports/day-22/rag-quality.md).
- `day-22` remains separate from main until explicit integration approval. Main's
  README documents the branch and setup independently of application code.

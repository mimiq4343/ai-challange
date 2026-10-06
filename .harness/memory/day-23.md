# Day 23: query rewrite and relevance filtering

Snapshot: 2026-10-06.

- The user approved query rewrite, an LLM reranker using the configured response
  model, adjustable candidate/context top-k and a relevance threshold, and three
  side-by-side RAG modes. Design stayed in chat. The user also explicitly approved
  merging Day 22 into main before creating `day-23`, then separately authorized
  `git push origin main` after automatic approval review rejected the initial push.
- [`rag-refinement-agent.ts`](../../src/lib/rag-refinement-agent.ts) keeps the
  original question for generation. Baseline uses the original query; rewrite
  and refined modes share one rewritten query and candidate list in comparisons.
  Reranker JSON must evaluate every known candidate exactly once; unknown IDs,
  missing scores, truncation and missing usage fail explicitly, without retries
  or fallback to rejected context.
- Defaults are candidate top-k 20, context top-k 5 and minimum relevance 6/10.
  The threshold is inclusive. Settings are bounded integers in versioned
  [`rag-refinement-config.ts`](../../src/lib/rag-refinement-config.ts), adjustable
  through the UI and captured in each report. No new model or dependency was added.
- `/day-23` and `/api/rag/refinement` preserve Day 21 and Day 22 behavior.
  The comparison includes ten existing corpus questions and two out-of-corpus
  questions. Only the blind judge sees expectations; labels are shuffled.
  Shared stage IDs prevent double counting provider usage. NDJSON cancellation
  waits for lock cleanup, and atomic report replacement accepts only a full run.
- First CLI run on the unchanged Day 22 index: positive-question quality
  6.7/7.7/8.1; evidence found in 7/8/8 of ten. Both negative questions kept
  five chunks in baseline/rewrite and zero in refined mode. History and stream
  completion still missed their implementation, so filtering cannot repair
  candidate recall. Scores are indicative: the same LLM generates, reranks
  and judges. See the full [quality report](../reports/day-23/rag-quality.md).
- The second run, triggered through the browser on the same index and settings,
  scored 6.8/7.3/8.4 on the ten positive questions, with the same 7/8/8 hits and
  zero refined context on both negative questions. A subsequent cancellation
  preserved the saved report and released the lock. Desktop/mobile checks also
  covered Day 7 drawer and focus behavior; see the report for verification scope.
- The user approved Day 23 integration and the Day 24 design on 2026-10-06.
  Before merging, all 31 RAG tests, the production build and `git diff --check`
  passed. The README conflict was only a remote versus local report link;
  the merged main uses the local report and identifies Day 23 as stable.

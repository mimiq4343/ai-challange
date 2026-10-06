# Day 24: grounded answers and honest refusal

Snapshot: 2026-10-06.

- The user approved the in-chat design and merging Day 23 into main before
  creating `day-24`. Main integration and its Day 24 timeline entry were pushed;
  Day 24 remains separate until the user approves integration.
- [`GroundedRagAgent`](../../src/lib/rag-grounding-agent.ts) reuses Day 23 rewrite,
  retrieval and reranking through `prepareContext`. The shared selection path
  keeps earlier RAG behavior and source numbering. No new dependency or model
  was added; the prior E5 index is reused as an immutable request/run snapshot.
- Generation returns strict JSON with status, answer, clarification, sources
  and quotes. The server requires exact source path/section/chunkId matches,
  known answer references and a verbatim quote for every cited source. Source IDs
  retain their context numbering even when generation cites only a subset.
  Invalid provenance, malformed output, truncated streams and missing usage
  fail explicitly. Saved reports revalidate citations against the answer text.
  Unknown clarification must also contain no source references: it becomes part
  of the displayed answer and must satisfy the same empty-evidence contract.
- If no candidate reaches the inclusive relevance threshold, the server returns
  unknown with clarification and empty evidence without invoking generation.
  A model can also return unknown when selected context does not support an
  answer. Rejected context is never a fallback.
- `/day-24`, `/api/rag/grounded` and its benchmark endpoint preserve earlier days.
  Existing answer/audit cards gained optional quotations. Audit distinguishes
  selected context from sources actually cited, including semantic refusal.
- The actual 2026-10-06 CLI run had sources and verbatim quotations in all ten
  corpus answers; the same LLM judged all ten semantically supported. Both
  negative controls refused with clarification. Control implementation chunks
  appeared in only 8/10: history/completion answers cite README and remain
  incomplete. Grounding is distinct from completeness; a matching quotation
  alone cannot guarantee semantic support. See the [full report](../reports/day-24/rag-quality.md).
- Benchmark expectations go only to the judge. Cancellation after HTTP 200
  preserved the report bytes, released the lock and restored UI controls.
  Cancellation during the atomic rename restores previous bytes, or removes
  a first report; a regression test covers both cases. Cancellation after a
  completed commit cannot revoke it, so UI notices describe the displayed report.
  Chromium checks covered desktop/mobile, actual Ctrl+Enter submission, refusal,
  quotation/source disclosure, 44 px targets and Day 7 drawer/Escape/focus.

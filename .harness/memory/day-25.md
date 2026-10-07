# Day 25: conversational RAG and task memory

Snapshot: 2026-10-07.

- The user approved the in-chat design and merging Day 24 into `main` before
  creating `day-25`. No separate design or plan file was requested. Main's README
  was updated as soon as the Day 25 branch appeared; application integration
  remains a separate decision.
- `/day-25` reuses `ConversationWorkspace`, `ConversationSidebar` and
  `RagAnswerCard`. `/api/conversations/[id]/rag-state` restores messages, task
  memory and source snapshots; `rag-messages` accepts only content and retrieval
  settings. Client-supplied history and task memory are rejected.
- The conversation owns its goal, clarifications, constraints and terms. Memory
  changes carry exact quotations from the current user message and a user-turn
  cursor. Unchanged keys remain; explicit corrections replace a key. Stored
  provenance is checked against the actual SQLite user messages.
- A reported second-turn HTTP 502 came from matching model-written memory
  quotations against the current user message. A controlled provider fixture
  reproduced it with the coordinated phrase "без замены SQLite и новых
  зависимостей": the rewritten quote "без новых зависимостей" is not contiguous.
  Real provider repetitions sometimes succeeded, so repeating the request was
  not a reliable fix. Memory patches now select `evidenceId` from server-supplied
  `evidenceOptions`; the server restores the original text. Whole messages,
  paragraphs and overlapping windows provide quotations bounded to 1,000
  characters. Foreign IDs and model-written quotes fail before saving. Existing
  persisted `evidence` strings, turn cursors and SQLite provenance checks remain
  compatible; no data migration is required.
- Only the last six messages accompany the persistent task memory in the prompt.
  The standalone current question drives rewrite/retrieval/reranking. Historical
  source IDs are not evidence for the current answer. Day 24 keeps its isolated
  question behavior; Day 13 keeps its profile-scoped stage machine.
- `rag_chat_exchanges` is an additive STRICT table with message/conversation
  foreign-key cascades. `SqliteConversationStore.saveExchange` optionally writes
  the completed grounded answer and task snapshot inside its existing transaction.
  A checked last-message cursor rejects stale concurrent requests with HTTP 409.
  Failed/cancelled inference or metadata writes leave messages and memory unchanged.
- RAG reads use one SQLite read transaction. An independent WAL writer can commit
  between individual SELECTs, so reading messages and metadata separately mixed
  old task memory with newer messages. A controlled two-connection test reproduced
  that race and verifies each returned snapshot belongs to one database commit.
- Day 25 generation selects source-local quote IDs. The server restores the exact
  corresponding text, then applies Day 24's strict provenance validator. Unknown
  IDs fail; no whitespace repair, translation or invented quote is accepted.
- Adding `getRagChat` required restarting the existing Next.js dev server:
  HMR retained the old global store instance and both new routes failed before
  inference with TypeError. A fresh process returned `/rag-state` successfully.
- A real RAG scenario exposed a provenance false positive: a document's literal
  `` `[S1]`–`[S5]` `` example was counted as current answer citations. Grounding
  validation now uses the existing CommonMark parser to exclude inline/fenced/
  indented code spans from citation discovery; original answer and quote bytes
  remain unchanged. Visible foreign references still fail. The existing
  `mdast-util-from-markdown` 2.0.3 transitive package is declared directly.
- Browser checks at 1440×1000 and 390×844 verified source blocks, source
  disclosures, restored task memory, explicit refusal and aborted exchange
  rollback. A mobile drawer focuses its first control, wraps Tab and restores
  the opener on Escape; `/day-7` regression also passed. No visible target was
  smaller than 44×44 and no horizontal viewport overflow was measured.
- The completed real benchmark used the frozen Day 22 E5 index and
  `deepseek-v4-flash`: goal retained and stable 24/24, corpus answers with sources
  and verbatim quotes 22/22, explicit negative refusals 2/2, SQLite reopen 2/2.
  The same-model judge marked constraints 22/24, terms 23/24 and current-question
  fit 23/24. History turn 5 reused the document's exchange wording despite the
  user's temporary definition; turn 9's generic clarification was off-topic.
  Stored memory was correct in both cases. These semantic limitations remain
  visible in [the report](../reports/day-25/rag-chat-quality.md), not corrected
  by rewriting generated answers. Total provider usage was 544,979 tokens.
- Initial verification passed: 58 RAG tests, 3 persistence tests, edited-file lint,
  TypeScript, production build and `git diff --check`. Next.js 16's build and dev
  output directories allowed the development server to stay running during build.
- The memory quotation fix passed 60 RAG tests, 3 persistence tests, edited-file
  lint, TypeScript and `git diff --check`. Three real memory-stage probes accepted
  the reported question. A separate browser dialogue completed its two turns,
  retained the original goal and all three constraints, and returned two sources
  with three quotations for `openChatDatabase`. Reload restored both answers,
  memory and sources. The real 24-turn benchmark and production build were not
  repeated for this focused fix; the existing report records the initial prompt.

# Day 33: user support assistant

Snapshot: 2026-10-18.

Integration update: 2026-10-18. The user explicitly requested merging `day-33`
into `main` after testing the application. The production build, all 11 support
tests and `git diff --check` passed before integration. The existing dev server
stayed running during the build.

- The user approved the in-chat design and implementation: Flash Chat as the
  product, synthetic JSON users/tickets, `/day-33`, real stdio MCP, FAQ RAG and
  persisted ticket conversations. Design and plan stay in chat. Branch `day-33`
  starts from integrated `main`; the user subsequently approved integration.
- `support-fixtures.json` validates required fields, unique IDs and user
  references. The MCP server exposes read-only `get_ticket`, `get_user`,
  `list_user_tickets` and `search_knowledge`, scoped to the selected ticket's user.
  The HTTP API exposes synthetic data only and has no operator authentication.
  Real CRM data needs a separate authentication/authorization design.
- `McpToolChatAgent` reuses its tool loop in `support` mode. Every answer needs
  fresh ticket/user/search evidence. The final validator rejects missing evidence,
  unknown citations, stale indexes and an unsupported answer without an explicit
  refusal. Citation checks establish provenance, not semantic correctness.
- `npm run support:index` indexes `docs/support/faq.md` and
  `docs/support/troubleshooting.md` with the pinned local E5 into
  `data/support-knowledge.sqlite`; initially 15 structural chunks. Real probes
  rank the correct section first for MCP 403, stopped replies and stale documents.
  A 0.78 threshold admitted a cooking query at 0.782; support now uses 0.82.
- `data/support.sqlite` stores a completed exchange with source snapshots in one
  STRICT row and transaction. Cursor checks run before inference and inside the
  transaction. The last six exchanges enter the prompt; the UI restores all saved
  exchanges. Traces remain transient. Cancellation before commit saves nothing;
  an interruption after commit can require refreshing to discover success.
- Browser testing found `focus()` after `setBusy(false)` ran before React enabled
  the textarea. A completion flag and effect now restore focus after the commit.
  Repeat desktop/mobile runs verified focus, sources, persistence, 44 px targets
  and no horizontal overflow. Mobile selection uses a native disclosure; keyboard
  selection closes it and restores focus to its summary.
- The FAQ distinguishes MCP authorization from Flash Chat accounts: there is no
  password login. An external HTTP 403 alone does not establish a token mismatch;
  the assistant must identify the component returning the refusal.
- Independent review identified a refresh/send race: a delayed manual GET could
  replace newer saved UI history. The browser regression `support-refresh.mjs`
  reproduced it before the fix. A request-generation check now ignores refresh
  results superseded by another refresh or a send. The regression then passed.

Product guide: [docs/support.md](../../docs/support.md).

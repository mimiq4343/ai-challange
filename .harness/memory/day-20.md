# Day 20: MCP orchestration

Snapshot: 2026-10-05.

- The user approved orchestrating our three MCP endpoints plus the external
  DeepWiki server (`https://mcp.deepwiki.com/mcp`, no auth), a code-only server
  registry (Day 16 UI servers are never exposed) and the six-call demo scenario.
  Design stayed in chat. `day-20` branched from `main` at `8b6b15a`; the user
  approved its integration into `main` on 2026-10-05.
- Registry: [`orchestration-config.ts`](../../src/lib/orchestration-config.ts).
  Allowlist and local argument schemas:
  [`orchestration-tools.ts`](../../src/lib/orchestration-tools.ts). The model sees
  `server__tool` names; `read_wiki_contents` is excluded because it returns a whole
  wiki above the 32 KB tool-result cap.
- [`mcp-router.ts`](../../src/lib/mcp-router.ts) opens all sessions in parallel via
  `withMcpTools` and keeps them until the loop ends. An unavailable server is
  reported (status + system note) instead of failing the run; an
  `McpConnectionError` during a call becomes an `isError` step result.
- `McpToolChatAgent` gained an `orchestration` mode instead of a second agent loop.
  Days 17–19 keep the single-endpoint path. In orchestration, schema failures and
  foreign `searchResultId`/`summaryId`
  ([`orchestration-chain.ts`](../../src/lib/orchestration-chain.ts)) are returned
  to the model unexecuted, and the last round omits tools so the model must summarise.
  `maxRounds` is `maxToolCalls + 1` for that final round.
- DeepWiki `ask_wiki_question` measured 10–15 s, beyond the old 15 s call deadline.
  Call deadlines are keyed by endpoint in `mcp-client.ts` (pipeline 90 s,
  DeepWiki 60 s, others 15 s); the per-session cap is `MCP_SESSION_TIMEOUT_MS` (300 s).
- The routing journal (`orchestration_runs`, `orchestration_calls`) is written by
  `mcp-chat-http.ts` from tool events and shown in the Day 20 inspector panel.
  Runs older than the deadline read as `interrupted`.
- Verification (2026-09-28): 282 tests, TypeScript, ESLint and a real browser run
  on an isolated profile. It made six calls in the expected order across four
  servers in 45 s, with a downloadable report and desktop/mobile checks. The smoke
  profile, conversation and report file were removed. With personalization
  disabled, `/api/profiles` returns 404, so the smoke profile is created through
  `SqliteProfileStore` directly.

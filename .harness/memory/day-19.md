# Day 19: MCP tool composition

Snapshot: 2026-09-27.

- The user approved a GitHub repository search, DeepSeek metadata review and
  downloadable Markdown report, in one automatic three-tool chat request.
  Design and plan stayed in chat. `day-19` branched from `main` at `716f354`;
  merging Day 19 has not been approved. README in `main` documents the branch
  separately without importing its application code.
- `/day-19` reuses `Day15Workspace`, existing memory/task/invariant behavior,
  streaming tool cards and the collapsible inspector. Reports survive reload;
  their panel refreshes after a request, on window focus and explicitly.
- [`pipeline-mcp-server.ts`](../../src/lib/pipeline-mcp-server.ts) exposes
  `search_repositories(query)`, `summarize_repositories(searchResultId)` and
  `save_to_file(summaryId)`. The private `/mcp/pipeline` endpoint uses its own
  server-only credential and a trusted profile header, never model arguments.
  [`mcp-auth.ts`](../../src/lib/mcp-auth.ts) now owns the shared authentication
  check; the scheduler-specific module/name was removed, not aliased.
- [`pipeline-store.ts`](../../src/lib/pipeline-store.ts) persists immutable
  source snapshots, complete summaries and report metadata in SQLite. Each ID
  is profile-scoped through its source. A report writes exact UTF-8 Markdown
  under a server-generated UUID filename with exclusive creation and fsync;
  duplicate saves verify and return the existing file. Download verifies its
  bytes against the stored summary and refuses foreign profiles and symlinks.
- Report files are ignored product data, not harness artifacts. Profile deletion
  cascades database rows, not filesystem files. A crash before the metadata
  commit can likewise leave an unreachable private file. Automatic orphan-file
  cleanup is not implemented; this limitation is documented in README.
- A real browser run proved that `tool_choice: auto` can stop after search.
  [`pipeline-config.ts`](../../src/lib/pipeline-config.ts) disables thinking
  only for the coordinator; after search, the next model tool call is required
  and only the expected tool is available. DeepSeek disallows required tool
  choices in thinking mode. The summary tool itself retains thinking.
  [Provider contract](https://api-docs.deepseek.com/api/create-chat-completion).
- SDK call timeout alone is insufficient: the custom fetch transport also needs
  the 90-second pipeline tool deadline. Discovery and scheduler calls retain
  15 seconds. Regression: [`pipeline-client.test.ts`](../../tests/pipeline-client.test.ts).
- The shared `ChatAgent` historically tolerates malformed SSE. Pipeline summaries
  opt into `strictStream`: malformed JSON, invalid text types and invalid UTF-8
  must abort instead of producing a partial savable report. Earlier chat behavior
  stays unchanged. Regressions use real MCP/ChatAgent/SQLite with only HTTP mocked
  in [`pipeline-mcp.test.ts`](../../tests/pipeline-mcp.test.ts).
- Verification included 270 passing tests, TypeScript, focused ESLint, public
  endpoint isolation, actual DeepSeek/MCP/GitHub pipelines at desktop and mobile
  widths, exact downloaded bytes versus tool results and stored snapshots,
  reload persistence, 44px controls and Escape focus restoration. Smoke uses an
  isolated profile so memory-router writes do not contaminate the user's profile.

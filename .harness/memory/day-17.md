# Day 17: first MCP tool

Snapshot: 2026-09-27.

- The user approved a real, read-only GitHub integration: `get_repository_info`
  accepts `owner` and `repo` and returns public repository metadata. It extends
  the existing npm MCP server; Docker and extra credentials are not required.
  The GitHub REST API version is pinned to `2026-03-10`.
- `/day-17` uses DeepSeek `deepseek-flash` tool selection, actual MCP `tools/call`,
  and the returned result in the final answer. Only the saved active-profile
  `https://mcp.yees.ai/mcp` endpoint and `get_repository_info` are executable;
  adding another server does not automatically authorize its tools.
- `PersonalizedChatAgent` accepts an injected responder. Its existing invariant
  guard executes before MCP discovery or execution; memory and task behavior
  remain shared with earlier days. Day 16 remains discovery-only.
- The new `mcp-messages` route emits NDJSON events defined in
  [`mcp-chat-types.ts`](../../src/lib/mcp-chat-types.ts). Only terminal `done`
  confirms persistence. Tool cards are transient; SQLite retains the complete
  user/assistant exchange, not the trace or private model reasoning.
- DeepSeek reasoning is replayed privately inside the tool loop. Provider usage
  includes all rounds, while incomplete usage remains unknown. Failed or
  cancelled generation does not persist a partial response.
- SDK 1.30.1 replaces its tool metadata cache on each `listTools` page. Preserve
  validators and required-task metadata across pages. Remote session cleanup
  needs an independent bounded signal after caller cancellation. Regressions:
  [`mcp-client-call.test.ts`](../../tests/mcp-client-call.test.ts).
- A failed sidebar refresh after `done` must not reclassify a saved exchange as
  failed or repopulate the composer. The UI reports the refresh error separately.
- Verification combines `npm run test:mcp`, persistence/invariant coverage,
  TypeScript/lint, and live browser success, GitHub 404, cancellation and mobile
  card/drawer checks. MCP success alone is not evidence of an LLM tool loop.

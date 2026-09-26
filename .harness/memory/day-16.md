# Day 16: MCP discovery

Snapshot: 2026-09-26.

- `day-16` starts from `main` after the Day 15 merge. `/day-16` reuses
  `Day15Workspace` through its `inspectorExtra` slot; it does not clone the agent.
- The user explicitly requested **no Docker** for this MCP server. Run it through
  `npm run mcp:server` on the development machine. Caddy on `ssh vm-proxy`, under
  `/data/caddy`, proxies `https://mcp.yees.ai/mcp` to that process. The route is
  recorded in [`deploy/mcp.Caddyfile`](../../deploy/mcp.Caddyfile); verify its
  upstream against the current runtime before applying it elsewhere.
- Discovery uses Streamable HTTP, closes the connection after all `tools/list`
  pages, and does not execute tools through the LLM. The example server exposes
  real `add` and `get_current_time` tools without access to files or credentials.
- Profile-scoped MCP configurations live in the existing SQLite database. Only
  name and HTTPS URL are saved; authentication headers, URL credentials/query
  parameters, redirects and arbitrary private-network endpoints are not supported.
  The configured MCP origin has an explicit private IPv4 exception.
- `WorkspaceInspector` is shared by Day 15 and Day 16. It remembers desktop
  visibility and retains its contents when hidden; mobile state is separate.
- Next dev may put its listening address in `Request.url` rather than the browser
  host. The mutation origin guard uses `Host`, not forwarded headers; regression:
  [`tests/mcp-api.test.ts`](../../tests/mcp-api.test.ts).
- Undici's wire-byte cap does not bound decompressed data. Discovery also limits
  decoded streams; [`tests/mcp-network.test.ts`](../../tests/mcp-network.test.ts)
  covers gzip expansion and cancellation of oversized event streams.
- A request-plus-cancellation batch can leave SDK JSON responses pending. The
  HTTP entrypoint races request handling against disconnect and has a response
  deadline, so cleanup does not depend on the SDK eventually sending a response.
- Verification entrypoints: `npm run test:mcp`, `npm run test:persistence`, focused
  ESLint, `npx tsc --noEmit`, CLI discovery, and real desktop/mobile browser checks.

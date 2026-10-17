# Day 31: developer assistant

Snapshot: 2026-10-17.

- The user approved the in-chat design: branch `day-31` from `main` (Day 25,
  without the unintegrated Day 28), cloud `OPENAI_MODEL`, a stdio project MCP
  server and a model-driven tool-loop where `search_docs` sits in the same MCP
  catalog as the git tools. The deterministic tool selection and an HTTP path
  on the public `mcp.yees.ai` server were rejected: the public server must not
  expose local diffs and runs from a different checkout.
- Product documentation now lives in [`docs/`](../../docs/README.md). The corpus is
  `README.md`, `AGENTS.md`, `docs/**/*.md` and `src/lib/*-schema.ts`
  ([`projectDocumentSources`](../../src/lib/project-docs.ts)). It reuses
  `indexDocuments`, local E5 and `SqliteDocumentStore` with a separate
  `data/dev-assistant.sqlite`; the Week 6 index is untouched.
- TypeScript schema sections are named by statement kind: a top-level `const`
  becomes `FirstStatement`, so retrieval questions over schema files must use
  that section name.
- [`createProjectMcpServer`](../../src/lib/project-mcp-server.ts) is read-only:
  `search_docs`, `git_branch`, `git_status`, `list_files`, `git_diff`. Git runs
  through `execFile` with `--literal-pathspecs`, `GIT_OPTIONAL_LOCKS=0`,
  `--no-ext-diff` and `--no-textconv`; listings and diffs cover tracked files only.
  Source IDs `S1…` are numbered per server instance, which is one `/help`.
- [`withProjectMcpTools`](../../src/lib/project-mcp-client.ts) spawns
  `scripts/project-mcp-server.ts <root>` with cwd at the app root (tsx and E5
  live there) and the SDK default environment, so LLM keys are not inherited.
  Connection takes about 1 s; the first `search_docs` loads ONNX in about 1 s.
- `McpToolChatAgent` gained the `project` access kind. Like orchestration it
  returns rejected arguments to the model and ends with a tool-free summary
  round. A real run failed once when the model asked for four tools in one
  round under a limit of three; limits became 4 per round and 10 in total, and
  the prompt now states them.
- 2026-10-17: the user saw `list_files("data")` fail as "not found" although
  `data/` exists. Untracked or ignored paths now return `status: untracked`
  or `ignored` with no entries, so contents stay hidden; only a missing path
  is an error. `data/` reports `untracked` because `.gitignore` lists files
  inside it, not the directory.
- Bare `/help` calls only `git_branch` and never the LLM. Any other text is a
  400. `/help` exchanges are not persisted.
- Environment finding: the first agent session could not open TCP connections
  to loopback or the host address (`EHOSTUNREACH`), which blocked curl, the bb
  CLI, browser automation and Turbopack's postcss worker. After the environment
  restarted, HTTP, headless browser (1440 and 390 px, reusable
  [script](../../tests/browser/dev-assistant.mjs)) and `npm run build` passed.
  A background `until ! pgrep -f <pattern>` watcher never exits because
  `pgrep -f` matches its own shell; use a `[x]`-style pattern.
- Turbopack warns that `resolve(".")` in a page traces the whole project;
  `process.cwd()`, as used by the stores, does not.
- `tests/mcp-network.test.ts` "compressed MCP bodies are limited after
  decompression" fails on clean `main` as well under Node 26.10; not caused by
  Day 31.

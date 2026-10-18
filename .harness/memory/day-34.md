# Day 34: project file assistant

Snapshot: 2026-10-18.

- The user approved the in-chat design and implementation on `day-34` from
  `main`: `/day-34` reuses Flash Dev with real stdio MCP, source search,
  document generation/updates and a separate Apply action. Design and planning
  stay in chat. On 2026-10-18, the user repeated the ADR scenario, applied the
  proposal and explicitly approved merging `day-34` into `main`.
- The earlier standalone README patch is superseded by the approved full
  integration. The consolidated README records Day 34 as available in `main`.
- Integration checks on 2026-10-18 passed: production build, 131 focused file,
  MCP, orchestration and developer-assistant tests, and `git diff --check`.
  The user's applied `docs/adr/file-assistant.md` was already untracked at
  integration start; it is preserved locally outside the merge commits.
- The `files` mode adds `read_file`, `search_files` and `propose_file` beside
  branch/status/listing tools. It excludes the old raw diff and RAG search to
  preserve the new file access boundary. Day 31 remains read-only with its
  original five-tool catalog. See the [product guide](../../docs/file-assistant.md).
- File proposals live in a separate ignored SQLite file. Apply loads server
  content by ID, verifies the checkout/branch/HEAD and target hash, then
  publishes a complete file atomically. Writes cover only README/product
  Markdown, with instruction files and links excluded. This still uses the
  local educational app's existing trust model; Origin checks are not login.
- A 2 KiB argument limit in the shared SSE reader initially rejected normal
  document proposals. The failing stdio/agent regression now passes with a
  per-mode argument budget; other modes keep their previous default.
- Real browser probes with `deepseek-v4-flash` searched source usages, generated
  a document, applied it, then updated only its heading. A keyboard test found
  that disabling Apply lost focus; the status now receives focus. The regression
  passes at 1440 and 390 px. See the [quality report](../reports/day-34/quality.md).
- Independent review found that rewriting diff headers also changed hunk
  lines beginning with `--- ` or `+++ `. A failing real-Git test reproduced
  it; header rewriting now stops at the first hunk, preserving preview content.
- A user screenshot showed raw DSML after 23 tool calls instead of an ADR.
  Deterministic regressions confirmed that the provider boundary accepted raw
  tool markup as a successful answer and that exploration could consume the
  entire budget. The reader now rejects unquoted DSML; final rounds retain
  the catalog with explicit `tool_choice: none`, and file mode reserves target reads and
  proposal calls. Read-only requests still require no file. The exact UI ADR
  example subsequently produced a real five-call proposal with all four ADR
  sections. The initial live rerun also succeeded, so the original provider
  leak is intermittent; its acceptance is reproduced deterministically.
- Review caught a false positive for quoted DSML in code explanations. The
  existing Markdown parser now distinguishes code/quotes from native markup;
  positive inline/fenced/blockquote cases and mixed quoted/raw rejection are
  covered without executing textual calls.

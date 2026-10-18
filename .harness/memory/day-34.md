# Day 34: project file assistant

Snapshot: 2026-10-18.

- The user approved the in-chat design and implementation on `day-34` from
  `main`: `/day-34` reuses Flash Dev with real stdio MCP, source search,
  document generation/updates and a separate Apply action. Design and planning
  stay in chat. Integration into `main` has not been requested.
- The separate `main` README update was rejected by automatic permission review
  because the current instruction authorized `day-34`, not shared-branch
  mutation. The [README-only patch](../reports/day-34/main-readme.patch) is
  prepared; `main` remains unchanged pending explicit approval.
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

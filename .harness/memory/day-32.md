# Day 32: automated PR review

Snapshot: 2026-10-18.

- User correction: Day 32 must be testable in the application's `/day-32`
  page, as previous challenge days are. A CLI and GitHub Action alone did not
  satisfy their expected workflow. The approved web screen selects base/head
  branches, starts the existing analyzer, streams progress and shows the diff,
  bugs, architecture findings, recommendations and retrieved sources.
- The web API resolves server-known refs to immutable SHAs without checkout,
  uses a separate temporary index per request and does not publish to GitHub.
  Reports live in page state; refresh clears them. Cancellation propagates to
  Git/LLM, and a stream without a terminal result is an error. Failed files stay
  unreviewed and the UI marks their report as partial. See the
  [web guide](../../docs/code-review.md#проверка-в-приложении).
- Web verification found two integration failures: concurrent downloads in one
  process collided on the PID-based temporary file, and immediately resolved
  tokenization promises starved Node's event loop. Unique download paths and
  an explicit event-loop yield before tokenization fixed them, with red/green
  regressions. The final small-corpus browser run found the seeded array-index
  regression in 4.8 seconds; cancellation during full-corpus chunking kept the
  branch API responsive. Measurements are in the
  [quality report](../reports/day-32/review-quality.md#проверка-страницы-day-32).
- The user approved the in-chat design and implementation on `day-32` from
  `main`: a GitHub Action over PR diffs, RAG over project documentation and
  source code, a Russian review comment with bugs, architecture concerns and
  recommendations. No separate spec or plan files were requested. Integration
  into `main` still requires an explicit request.
- [`ai-code-review.yml`](../../.github/workflows/ai-code-review.yml) uses
  `pull_request_target`. Only the exact trusted `base.sha` and its dependencies
  execute. The PR ref is fetched as Git objects and is never checked out,
  imported, built or tested with secrets. Dependency caching is disabled;
  third-party Actions are pinned to immutable commits, Node.js to `24.22.0`.
- [`code-review-git.ts`](../../src/lib/code-review-git.ts) computes a three-dot
  diff through the merge base. It reads immutable blobs, including deleted and
  renamed files, disables external diff/textconv and reports excluded or
  oversized files explicitly. Local working-tree edits do not enter a review.
  Deletion-only hunks can anchor findings to surviving head lines; completely
  emptied files use their removed base content. A real-Git regression test
  covers removal of an authorization check without adding any line.
  Findings without a line are allowed only when there are no line anchors,
  such as pure renames and metadata changes; their links point to the file.
- [`code-review-rag.ts`](../../src/lib/code-review-rag.ts) reads `README.md`,
  `AGENTS.md`, `docs/**/*.md` and `src/**/*.ts(x)` from the exact base SHA.
  It reuses structural chunking, pinned local E5, cosine ranking and the
  project's SQLite connection lifecycle. A separate temporary index binds its
  vectors to the base SHA and selects up to three documentation and five code
  fragments per file. The existing day indexes are unaffected.
- Each LLM request includes the selected file's complete text, its patch,
  changed line numbers, the other selected PR patches and retrieved sources.
  RAG describes the pre-PR base; the prompt explicitly accounts for coordinated
  changes across PR files. Findings must satisfy a JSON schema, point at a
  valid change anchor (or a file-level null line when none exist) and cite
  only retrieved source IDs. Failed, timed-out or
  truncated responses remain unreviewed and make the CLI exit nonzero.
- [`code-review-github.ts`](../../src/lib/code-review-github.ts) paginates
  comments, updates only `github-actions[bot]` with the Day 32 marker, and checks
  open state plus both SHAs before writing. It creates an ordinary PR issue
  comment, so `can_approve_pull_request_reviews` is not required. Comment
  budgets cover findings, skipped files and limitations; truncation preserves
  the full JSON and reports omitted counts. A repository's
  default read-only workflow token can be elevated by the workflow's explicit
  `pull-requests: write` permission.
- The existing provider key was configured as repository Actions Secret
  `OPENAI_API_KEY`; its URL as Actions Variable `OPENAI_BASE_URL`. Values were
  transferred through stdin and never printed or put in command arguments.
  The model is versioned as `deepseek-v4-flash` in `code-review-config.ts`.
- The local `review:pr -- --base <SHA> --head <SHA> --repository owner/repo`
  command never publishes to GitHub. `--event` additionally fetches the PR and
  publishes its comment. Reports live in ignored `data/code-review/`; failures
  replace `review.json` with an explicit failed result instead of leaving an
  older success. The workflow also writes Actions Summary and a seven-day
  artifact. It becomes operational after the workflow reaches the PR base;
  the PR introducing the workflow cannot review itself with that workflow.
- Real verification indexed 274 files / 3825 structural chunks and sent three
  documentation plus five code fragments to `deepseek-v4-flash`. A deliberately
  seeded `WHERE ? IS NOT NULL` regression in an isolated copy was correctly
  reported as a high-severity deletion of all conversations. Some retrieved
  code chunks contained only imports, and a caller claim exceeded their
  evidence; structural validation does not guarantee semantic grounding.
  Retrieval now excludes import-only AST chunks for ordinary edits but keeps
  them for renamed files to find dependencies on old paths. A failing regression test
  demonstrated the issue and passed after filtering. The full LLM run was
  not repeated after that retrieval change.
  See the [quality report](../reports/day-32/review-quality.md). Live Actions
  publication remains unverified until integration into the PR base.

# Day 35: real release preparation

Snapshot: 2026-10-18.

- The user approved Flash Release in chat: a `/day-35` page selecting Git
  branches or tags, AI release notes with evidence, actual GitHub Actions
  results and a Markdown proposal saved through Flash Files. Work stays on
  `day-35` until explicit integration approval; design and planning remain in chat.
- `release-git.ts` reuses Day 32's immutable snapshot collector and resolves
  annotated tags to commits. The selected base must be an ancestor of head;
  divergent branches are rejected instead of silently changing the comparison.
  Local uncommitted changes never enter the snapshot.
- `release-agent.ts` uses the existing `ChatAgent` with the versioned
  `deepseek-v4-flash` model. JSON items cite known F/C IDs; behavior, risk and
  verification claims require a file diff. The server renders immutable links
  and separates AI recommendations from actual CI results. This validates
  references, not the semantic truth of model interpretations.
- `release-ci.ts` queries Actions API `2026-03-10` for the exact head SHA,
  paginates and selects the latest run per workflow/event. Missing, skipped,
  neutral, pending, inaccessible or incomplete results cannot become success.
  A CI access failure does not discard otherwise valid release notes.
- Report Markdown goes to `docs/releases/<base:12>-<full head>.md` through
  Day 34's proposal store and Apply action. Changing checkout/HEAD during
  analysis prevents a proposal; Apply also verifies its original file hash.
  No release/tag publication, deployment or GitHub mutation is implemented.
- A real browser run compared `c80c34e` with `03c420b`: 6 commits, 23/38
  analyzable files, a valid AI response and a 25,675-character Markdown proposal.
  No Actions runs existed for that SHA; the UI explicitly marked checks unknown.
  Apply wrote 32,296 UTF-8 bytes and kept keyboard focus on its result. The
  verification-only generated file was removed afterwards.
- A browser regression exposed Enter on Stop immediately starting another
  request: React reused the same button node while switching its type to submit.
  Distinct keys for Stop/Prepare fix it. Keyboard prepare/apply/cancel, truncated
  responses, 44px controls and no horizontal overflow pass at 1440/390px.
  Day 7's drawer and focus behavior were also smoke-tested unchanged.
- See the [product guide](../../docs/release.md) and
  [quality report](../reports/day-35/quality.md) for contracts and verification.
- Independent review found that source-link expansion can push otherwise valid
  AI output beyond Flash Files' 64,000-character proposal limit. A real-Git
  regression reproduced the escaping `ZodError`. The pipeline now checks both
  proposal character/byte limits and returns the completed downloadable report
  with an explicit `proposalError`, without creating a proposal.
- `day-35` was pushed with the implementation (`abc2349`) and a separate
  README-only timeline commit (`1d35fa8`). Automatic approval review rejected
  advancing/pushing `main` as an unapproved integration with possible deployment
  impact. Both local and remote `main` remain at `03c420b`; no command from the
  rejected batch executed. Ask for explicit approval before retrying the
  README-only update. The feature itself is published on `day-35`.

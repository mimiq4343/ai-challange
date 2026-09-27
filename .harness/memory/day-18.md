# Day 18: scheduler and background tasks

Snapshot: 2026-09-27.

- The user approved periodic GitHub monitoring, SQLite persistence, a separate
  Node.js worker, a summary feed in `/day-18`, and npm-based `systemd` services
  without Docker. Design and implementation plan stayed in chat.
- Day 17 was explicitly approved for integration and merged into `main` at
  `beeab15`; `day-18` branched from that merge. The user subsequently approved
  merging Day 18, including its documentation and memory, into `main`.
- [`scheduler-tool-schemas.ts`](../../src/lib/scheduler-tool-schemas.ts) defines
  the four model-visible tools. The protected endpoint is separate from public
  `/mcp`. Its server credential and profile context never come from model
  arguments. The public endpoint preserves Day 16/17 behavior.
- [`scheduler-store.ts`](../../src/lib/scheduler-store.ts) uses the existing
  `data/chat.sqlite` connection convention. Profile-owned jobs and runs cascade
  on profile deletion. Claims are transactional and fenced; recovery reuses a
  saved sample and one logical run. Stop rejects late publication. A completed
  MCP mutation survives cancellation or failure of the final chat response.
- [`scheduler-config.ts`](../../src/lib/scheduler-config.ts) owns interval,
  capacity, lease and deadline limits. Missing required credentials fail rather
  than falling back. This remains a trusted-LAN application, not a login system.
- [`scheduler-worker.ts`](../../src/lib/scheduler-worker.ts) performs collection
  and summary generation independently of Next.js. Failed generation keeps the
  sample. Fewer than two samples means unknown deltas, not zero. Downtime is
  coalesced into one current collection rather than a replay of missed slots.
- Runtime configuration lives in `deploy/flash-*.service`; apply it through
  [`install-scheduler-services.sh`](../../scripts/install-scheduler-services.sh).
  The user approved enabling these services at boot. They run from the current
  checkout, so do not switch it to a branch without scheduler code while active.
  Reapplying deployment restarts both services even when unit files are unchanged:
  changed source or credentials otherwise stay stale in long-running processes.
- Verification combines `npm run test:scheduler`, existing regression tests,
  real DeepSeek-to-MCP creation and aggregate retrieval, actual worker/systemd
  execution, and desktop/mobile browser checks. Periodic live-API smoke uses
  an isolated database and explicitly controlled clock; it does not change the
  host clock or production interval limits.
- Live chat smoke can create profile-wide long-term memories through the router.
  Deleting a conversation sets their source reference to NULL; it does not delete
  them. Use an isolated profile, or identify and remove only smoke-owned router
  memories before deleting the test conversation.
- Scheduler action buttons use `aria-disabled` with handler guards rather than
  removing focus via native `disabled`. This keeps Escape functional inside the
  existing mobile inspector after asynchronous stop/summary actions.

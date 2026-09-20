# Project memory index

Durable notes for the AI Advent Challenge #9 repository: project decisions, verified
findings and user preferences, one topic per entry. Read this index first, then only
the entries a task actually needs. Entries are dated snapshots, not policy — check
them against the current sources before relying on them.

## Project and workflow

- [project.md](project.md) — repository purpose, stack, day route/branch map, standard verification commands.
- [challenge-branch-workflow.md](challenge-branch-workflow.md) — `day-N` branch workflow and the README rules for `main` and day branches.
- [keep-dev-server-running.md](keep-dev-server-running.md) — the user watches the app over the server's internal network address; never leave the dev server stopped.
- [fluid-fullwidth-layouts.md](fluid-fullwidth-layouts.md) — user requirement: fully fluid full-viewport layouts instead of fixed-width containers.

## Days

- [day-7.md](day-7.md) — persistent conversations, `SqliteConversationStore`, `PersistentChatAgent`, `/api/conversations`.
- [day-8.md](day-8.md) — token accounting, provider usage as source of truth, the single real overflow run.
- [day-9.md](day-9.md) — immutable summary checkpoints, `CompressedChatAgent`, blind benchmark results.
- [day-10.md](day-10.md) — Sliding Window, Sticky Facts and Branching strategies with their benchmark numbers.
- [day-11.md](day-11.md) — three memory layers, the memory router, `memory_*` tables and the layer toggles.

Approved designs and implementation plans live outside memory, in
[`../superpowers/`](../superpowers); the workspace index is [`../README.md`](../README.md).

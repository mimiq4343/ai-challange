# Harness workspace

Agent working materials for this repository. Product documentation stays in the root
[`README.md`](../README.md) and the project rules in [`AGENTS.md`](../AGENTS.md);
nothing under `.harness/` is user-facing. Read this index first, then only the
material a task needs. Everything here is versioned with the project and must never
contain secrets.

## Memory

[`memory/`](memory) — durable project decisions, verified findings and user
corrections as short single-topic entries, written in English. Start from
[`memory/MEMORY.md`](memory/MEMORY.md).

## Superpowers designs

[`superpowers/specs/`](superpowers/specs) — approved designs, one per challenge day:

- [Day 7 · context persistence](superpowers/specs/2026-09-13-day-7-context-persistence-design.md)
- [Day 8 · token accounting](superpowers/specs/2026-09-14-day-8-token-accounting-design.md)
- [Day 11 · memory layers](superpowers/specs/2026-09-20-day-11-memory-layers-design.md)

## Superpowers plans

[`superpowers/plans/`](superpowers/plans) — implementation plans for those designs;
multi-task plans are directories whose `00-overview.md` links the spec:

- [Day 7 · context persistence](superpowers/plans/2026-09-13-day-7-context-persistence/00-overview.md)
- [Day 8 · token accounting](superpowers/plans/2026-09-14-day-8-token-accounting/00-overview.md)
- [Day 11 · memory layers](superpowers/plans/2026-09-20-day-11-memory-layers.md)

## Conventions

- This branch is `day-11`, created from `day-8`; Day 9 and Day 10 materials live in
  `main` and are intentionally absent here.
- Reports belong in topical subdirectories of `reports/`, historical material in
  `archive/`; create either directory only when there is material for it.
- This repository has no `openspec/` directory, so OpenSpec artifacts and steps do
  not apply; if one is added later, link it here without copying its artifacts.
- Update this index in the same change that adds, renames, moves, archives or
  deletes material here, and fix the consumers of any moved path.

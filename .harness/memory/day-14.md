# Day 14: invariants

- Branch `day-14` was created from `main` (days 1–13). Invariants belong to the
  profile, live in `memory_invariants` and apply across every conversation and task.
- Categories: `architecture`, `tech_decision`, `stack`, `business_rule`. A retired
  rule keeps its row (`status = 'retired'`) so the violation journal keeps its anchor.
- Two enforcement layers:
  1. `invariant-guard.ts` runs before generation — one cheap call with
     `reasoning_effort: "none"` returning `{verdict, invariantIds, explanation,
     alternative}`. On `conflict` the chat model is never called: the server streams
     the refusal, bumps `blocked_count` and writes `violation_blocked`.
  2. The invariant block is the first system message after the base role, with an
     explicit «refuse and quote the rule» instruction.
- An unreadable guard answer, an unknown invariant id or a missing explanation all
  degrade to `allow`: a broken safety net must not become a denial of service.
  With an empty rule set the guard is not called at all.
- The refusal quotes the rule with its rationale, explains the conflict, offers an
  alternative and states that the rule changes only through the panel — not by
  arguing in the chat.
- The router can propose invariants (`invariantProposals`); they wait for a human
  confirmation, duplicates of existing statements are dropped.
- `PersonalizedChatAgent` got a third option, `invariants`, next to `personalization`
  and `taskState`; there is still one agent and one `flush` pipeline.
- Verified live on 2026-09-21 with «Только PostgreSQL, без ORM»: the MongoDB + Prisma
  request was refused with the quote and an alternative, `blocked_count` went to 1,
  a neutral query about speeding up a SELECT passed through, and retiring the rule
  unblocked the same request.
- Permanent checks: `npm run test:invariants`, plus the task, memory, profile, token,
  compression and context-strategy suites.

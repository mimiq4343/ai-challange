# Day 15: controlled transitions

- Branch `day-15` was created from `main` (days 1–14) and merged back on 2026-09-21. Day 13 already had the stage
  table, the pause and the journal; Day 15 adds preconditions, plan approval and a
  visible reaction to a rejected transition.
- Preconditions live in `task-machine.ts` as a pure function: `planning → execution`
  needs a non-empty approved plan, `execution → validation` needs every step closed,
  `* → done` needs `origin === "user"`. The context (`planApproved`, `totalSteps`,
  `openSteps`) is passed as an argument, so the module still has no database.
- `task_runs` gained `plan_approved`, `plan_approved_at`, `last_rejection` and
  `last_rejection_at`. Editing the plan after approval resets the flag and logs
  `plan_reset`; a successful transition or an approval clears the rejection.
- `task_events` gained the kinds `plan_approved` and `plan_reset`, which required
  rebuilding the table (STRICT CHECK cannot be altered in place).
- The rejection is surfaced three ways: a panel banner, a disabled transition button
  with the reason in its title, and a line in the task block of the next prompt with
  «Объясни пользователю, чего не хватает». Without that line the agent never learned
  about its own rejected attempt.
- Approval comes from the human: the panel button or an explicit phrase that the
  router marks as `taskState.planApproved`. The router prompt forbids approving on
  the agent's own initiative.
- Day 13 and Day 14 pages share the same machine, so they inherit the preconditions;
  only the new `/day-15` page documents them.
- Verified live on 2026-09-21: transition to execution without approval returned 409
  and the assistant explained what is missing; after the approval button the same
  transition passed; `execution → done` stayed blocked by the table and
  `execution → validation` by «Осталось незакрытых шагов: 3».
- Permanent checks: `npm run test:tasks` (23 tests) plus the other suites.

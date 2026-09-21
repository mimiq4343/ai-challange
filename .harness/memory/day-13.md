# Day 13: task state machine

- Branch `day-13` was created from `main` (days 1–12). The task state belongs to the
  profile, not to a conversation, so pausing, closing the chat and continuing in a new
  one keeps the same stage and step.
- Stages: `planning`, `execution`, `validation`, `done`, `blocked`, `cancelled`.
  Pause is an orthogonal flag, never a stage. `blocked` stores `blocked_from` and
  returns only there. `done` and `cancelled` are terminal.
- Pause invariant: while `paused = 1` the server rejects every agent-proposed
  transition and logs it as `rejected`; only a human `resume` unfreezes the machine.
  Verified live: the agent kept answering, the stage stayed `execution`.
- `task-machine.ts` is pure (no DB, no network): the transition table, `checkTransition`
  and the default expectation per stage. `task-store.ts` owns `task_runs`,
  `task_steps`, `task_events` and applies agent updates in one transaction.
- A partial unique index keeps one live task per profile:
  `task_runs(profile_id) WHERE stage IN ('planning','execution','validation','blocked')`.
- Prompt order is `system → profile → task → LTM → WM → STM → request`;
  `taskTokens` joins the prefix-difference breakdown and the `TASK` telemetry segment.
- No third chat agent: `PersonalizedChatAgent` got the options `personalization` and
  `taskState`, so Day 12 and Day 13 share one `flush` pipeline.
- Router budget had to grow from 512 to 1024 output tokens: with three memory layers
  plus `taskState` the JSON was truncated mid-array and every update was dropped.
  The symptom looked like "the model ignores taskState" — it was a cut response.
- Personalization is disabled through `FEATURES.personalization` in
  `src/lib/feature-flags.ts` (versioned config, not env). Off means: no profile block,
  no preference learning, `/api/profiles/*` → 404, a notice instead of the panel on
  `/day-12`. Tables `memory_profiles`, `memory_profile_constraints` and
  `memory_long_term.profile_id` stay, because Day 11 memory lives inside a profile;
  everything silently runs on «Основной». Restoring costs one `false → true`.
- Live run on 2026-09-21: plan of four steps written in `planning`, first step closed
  with a transition to `execution`, a rejected agent transition during the pause, and
  a one-word «Продолжаем» in a fresh conversation produced the draft for step 2.
- Permanent checks: `npm run test:tasks`, plus the memory, profile, token, compression
  and context-strategy suites.

# Day 13: task state machine

- Branch `day-13` was created from `main` (days 1–12) and merged back on 2026-09-21. The task state belongs to the
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
- The task is not created by hand: the router returns `taskProposal` when the request
  implies multi-step work, and the panel shows a confirm card. `task_proposals` keeps
  one pending proposal per profile; a live run ignores new proposals.
- Two bugs found by the user's «составь план питания на неделю» run:
  1. The router only received the task rules when a task already existed
     (`task: Boolean(input.task)`), so it could never propose one. Fixed with an
     explicit `taskEnabled` flag.
  2. The state block alone did not change behaviour — the agent dumped the whole
     answer. `TASK_STEPWISE_RULES` now joins the base system prompt whenever the task
     layer is on: a numbered 3–7 step plan while planning, one step per exchange in
     execution.
- A transition to the current stage is treated as a no-op instead of a `rejected`
  event, otherwise the journal filled with noise.
- In dev the store singletons live in `globalThis`, so adding a store method requires
  restarting `next dev`; HMR keeps the old instance and the page 500s.
- `deepseek-flash` is a reasoning model and its `reasoning_content` is billed against
  `max_tokens`. Two failures came from that:
  1. The chat used `max_tokens = 4096` (the Day 8 response reserve). On a heavy request
     («план питания на месяц с ограничениями по БЖУ») the whole budget went into
     reasoning, `content` stayed empty, `finish_reason = length`, and the stream died
     with «failed to pipe response» — the browser showed a bare «Load failed».
     Fixed by raising `responseReserveTokens` to 16 384 (reserve and `max_tokens` stay
     one number, so the context math keeps matching reality).
  2. The memory router hit the same wall at 1 024 tokens and returned an empty JSON,
     silently dropping every write and proposal. Fixed with `reasoning_effort: "none"`
     on the router call: it extracts facts and needs no thinking (51 → 5 completion
     tokens on a probe). Reasoning stays on for the chat itself.
- `ChatAgentResponse.finishReason` now travels with the stream, so an empty answer is
  reported as «модель израсходовала лимит ответа на рассуждения», and the workspace
  turns a `TypeError` from a broken stream into a readable Russian message.
- The router used to fill `taskState` instead of `taskProposal` when no task existed;
  the rules now say plainly that an absent machine means `taskState = null`.
- Permanent checks: `npm run test:tasks`, plus the memory, profile, token, compression
  and context-strategy suites.

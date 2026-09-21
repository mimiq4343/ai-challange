# Day 12: assistant personalization

- Branch `day-12` was created from `main` (days 1–11) and adds a user profile on top
  of the Day 11 memory layers. Days 6–11 keep working. Merged into `main` on
  2026-09-20 without conflicts, so `main` now carries days 1–12.
- A profile owns its long term memory: `memory_long_term` gained `profile_id` and the
  uniqueness moved to `(profile_id, kind, key)`. Switching profiles switches both the
  answer style and the facts the agent knows.
- `/day-11` now works with the long term memory of the active profile. Two competing
  LTM semantics were deliberately rejected.
- Exactly one profile is active; it is server state guarded by a partial unique index
  on `memory_profiles(active) WHERE active = 1`, mirroring the working-memory task.
- Preferences are validated enums (`tone`, `verbosity`, `format`, `language`,
  `expertise`) plus free-form `role` and a `memory_profile_constraints` list.
- `memory-schema.ts` owns the whole memory schema and its idempotent migrations:
  rebuilding `memory_long_term` under profiles, extending `memory_writes` with the
  `profile` layer, and adding `profile_tokens` to `memory_exchange_usage`. It calls
  `ensureConversationSchema` first, because memory tables reference `conversations`
  and `messages`; `conversation-schema.ts` was extracted from `conversation-store.ts`
  for that reason.
- The prompt order is `system → profile → LTM → WM → STM → request`; prefix
  differences keep `system + PROF + LTM + WM + STM + request === promptTokens`.
- The memory router writes a third layer: enum values are validated, unknown values
  dropped, `constraint` accepted as text. Verified live on 2026-09-20: «отвечай
  короче и без эмодзи» switched `verbosity` from `detailed` to `brief` and added the
  constraint «без эмодзи» with `origin = router`.
- Verified live with two profiles on one question: «Инженер» (direct, brief,
  code_first, expert, no emoji) answered with SQL and Python blocks only; «Новичок»
  (friendly, detailed, prose, beginner) answered with an analogy and numbered steps.
  With the `PROF` toggle off telemetry showed `PROF 0` and a neutral answer.
- The existing `data/chat.sqlite` migrated cleanly: profile «Основной» was created and
  the three Day 11 entries kept their ids under `profile_id = 1`.
- Permanent checks: `npm run test:profiles`, plus `test:memory`, `test:persistence`,
  `test:tokens`, `test:compression`, `test:context-strategies`.

# Day 11: explicit agent memory model

- Branch `day-11` was created from `day-8`, not from `main`: Day 9 compression and
  Day 10 context strategies are deliberately absent. `/day-7` and `/day-8` keep
  working, including `/api/token-experiments/*`.
- Three layers, stored separately: STM is a verbatim window of the last 8 messages
  from `messages`; WM is one active task per conversation with typed slots; LTM is
  global across conversations and survives conversation deletion.
- All Day 11 tables use the `memory_` prefix (`memory_long_term`,
  `memory_working_tasks`, `memory_working_slots`, `memory_writes`,
  `memory_exchange_usage`) because the local database had leftover tables named
  `long_term_memory`, `working_memory` and `memory_events` from other agents.
- `sqlite-database.ts` owns one reference-counted `DatabaseSync` per file so
  `SqliteConversationStore` and `SqliteMemoryStore` never open a second writer.
- `LTM` is unique on `(kind, key)`: a repeated fact updates the entry instead of
  accumulating duplicates. A partial unique index enforces one active task per
  conversation.
- The memory router is a separate non-streaming call after the completed exchange.
  It returns strict JSON with a reason per write. Its failure is logged once and
  never rolls back the saved exchange; a malformed single write is dropped while
  the rest are applied.
- `composeMemoryPrompt` emits `system → LTM block → WM block → STM window`;
  `countMemoryPromptTokens` measures each layer by chat-template prefix
  differences, so `system + LTM + WM + STM + request === promptTokens` exactly.
  Budgets: LTM 2 000 tokens, WM 1 000 tokens.
- Verified live on 2026-09-20 with `deepseek-v4-flash`: after the first exchange the
  router stored `user_name: Роман`, `preferred_language: TypeScript` and
  `avoid_third_party_deps` plus a working-memory task with one slot. A fresh
  conversation answered "Тебя зовут Роман, и код ты пишешь на TypeScript"; with the
  LTM toggle off the same question returned "Я не знаю" and telemetry showed
  `LTM 0`. A later exchange reported `sys 54 · LTM 84 · WM 0 · STM 63 · req 20 · Σ 221`.
- The `/day-11` page has no "Масштаб контекста" block and no exchange cards: token
  telemetry lives in one compact line under the composer, and the right rail is the
  memory inspector (bottom sheet on mobile).
- Permanent checks: `npm run test:memory`, plus `npm run test:persistence` and
  `npm run test:tokens` for the Day 7 and Day 8 regressions.

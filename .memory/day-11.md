# Day 11: agent memory model (branch day-11-kimi)

- Route `/day-11` implements three explicitly separated memory layers: short-term
  (existing `messages` table, sent whole per request), working (`working_memory`,
  scoped per conversation via FK cascade) and long-term (`long_term_memory`,
  global, categories profile/decision/knowledge).
- Saving is manual only: the Memory panel adds/deletes entries through
  `/api/memory/*`; the agent never writes memory itself. Limits: 500 chars per
  entry, 50 long-term and 20 working-per-conversation entries.
- `buildSystemPrompt` in `src/lib/memory.ts` folds both layers into the system
  prompt; `PersistentChatAgent` passes it to `countChatPrompt` (preflight grows)
  and to `ChatAgent.respond` via the new optional `options.systemPrompt`.
- `GET /api/memory?conversationId=` returns a `MemorySnapshot` with per-entry
  token estimates and the exact injected text, rendered in the panel under
  "Что уходит в system prompt".
- Day 8 telemetry moved into a compact `TokenTelemetryStrip` under the composer
  (`composerFooter` slot in `ConversationWorkspace`); the "Масштаб контекста"
  comparison block was removed from the page, overflow API endpoints kept.
- Verified live: long-term fact answered in a fresh conversation; working note
  known only inside its own conversation (control chat answered it does not
  know); mobile sheet 390px, 44px targets, no horizontal overflow.
- `npm run test:memory` covers layer separation, cascade, validation/limits,
  prompt composition and snapshot contents.
- Note: `data/chat.sqlite` had conflicting `long_term_memory`/`working_memory`
  tables from the parallel `day-11-glm` experiment; rows were backed up to
  `data/day-11-glm-memory-backup.json` and the tables recreated with this schema.
- Branch naming: challenge day branches may carry a model suffix
  (`day-11-glm`, `day-11-kimi`); app routes stay `/day-N`.

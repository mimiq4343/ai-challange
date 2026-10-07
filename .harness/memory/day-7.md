# Day 7: persistent context

- The `/day-7` page supports several independent conversations, a desktop sidebar and a mobile drawer.
- History is stored in `data/chat.sqlite` through the built-in `node:sqlite`; the SQLite, WAL and SHM files are excluded from git.
- `SqliteConversationStore` keeps `conversations` and `messages` in STRICT tables with foreign keys and `ON DELETE CASCADE`.
- `PersistentChatAgent` restores history before calling the existing `ChatAgent` and persists only a fully completed `user + assistant` pair.
- An aborted or failed stream leaves the persisted history unchanged.
- `/api/conversations` and its nested routes serve list, create, detail, delete and send. Day 6 keeps using `/api/chat` unchanged.
- Hands-on check confirmed: after a full Next.js restart the agent recalled the code word from SQLite; a deleted conversation did not come back after the next restart.
- Permanent tests run with `npm run test:persistence`.

## Deletion recovery (2026-10-07)

- An open browser list can retain a conversation removed in another tab or by
  cleanup of a test fixture. `ConversationWorkspace` treats DELETE 404 as already
  deleted, removes the stale row and switches the active context. The API keeps
  its existing 204/404 contract and SQLite foreign-key cascade.
- `ConversationSidebar` catches rejected deletion promises, displays the error
  inside the confirmation dialog and permits retry. Network failures get a
  Russian recovery message. A successful deletion followed by a failed load of
  the next conversation closes the dialog and reports the load failure in the
  workspace; it does not report deletion failure or reject the event handler.
- The [browser regression](../../tests/browser/conversation-deletion.mjs) creates
  only its own fixtures and blocks DELETE requests targeting other conversations.
  With a BB browser session open on `/day-7` or `/day-25`, run it with
  `bb browser-automation run <session-id> --script-file <absolute-repo-path>/tests/browser/conversation-deletion.mjs --script-host <host-id> --json`.
- The regression first reproduced the exact unhandled "Диалог не найден." error,
  then passed stale deletion, HTTP 500, network failure, successful retry and
  next-conversation load failure at 1440×1000 and 390×844 on both routes. Mobile
  drawer focus and Tab wrapping, 44×44 dialog targets and absence of horizontal
  overflow passed. Three persistence tests, edited-file lint and TypeScript
  passed. No production build or LLM benchmark was needed for this UI-only fix.

# Day 7: persistent context

- The `/day-7` page supports several independent conversations, a desktop sidebar and a mobile drawer.
- History is stored in `data/chat.sqlite` through the built-in `node:sqlite`; the SQLite, WAL and SHM files are excluded from git.
- `SqliteConversationStore` keeps `conversations` and `messages` in STRICT tables with foreign keys and `ON DELETE CASCADE`.
- `PersistentChatAgent` restores history before calling the existing `ChatAgent` and persists only a fully completed `user + assistant` pair.
- An aborted or failed stream leaves the persisted history unchanged.
- `/api/conversations` and its nested routes serve list, create, detail, delete and send. Day 6 keeps using `/api/chat` unchanged.
- Hands-on check confirmed: after a full Next.js restart the agent recalled the code word from SQLite; a deleted conversation did not come back after the next restart.
- Permanent tests run with `npm run test:persistence`.

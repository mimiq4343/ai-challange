# Project instructions

## Stack

- Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4.
- Runtime: Node.js 22.13 or newer. Use the built-in `node:sqlite`; do not add a native SQLite dependency.
- UI copy is Russian. Reuse the existing Flash Chat colors, typography, components, and interaction patterns.

## Repository workflow

- Each AI Advent Challenge day is developed on its own `day-N` branch, then merged into `main` when approved.
- Keep previous day routes and APIs working unless the task explicitly replaces them.
- Do not commit `.env.local`, API keys, `data/*.sqlite`, `data/*.sqlite-wal`, or `data/*.sqlite-shm`.
- Prefer focused edits. Do not introduce a second convention beside an existing implementation.

## Application boundaries

- Keep LLM credentials and saved conversation context server-side.
- Day 6 owns `/day-6`, `/api/chat`, `Chat`, and `ChatAgent`.
- Day 7 owns `/day-7`, `/api/conversations`, `ConversationWorkspace`, `ConversationSidebar`, `PersistentChatAgent`, and `SqliteConversationStore`.
- SQLite is the source of truth for Day 7. Load prior messages by conversation ID on the server before each LLM call.
- Persist only a fully completed `user + assistant` exchange, in one transaction. Never persist a partial or failed stream.
- Deleting a conversation must delete its messages through the database foreign-key cascade.

## Verification

Run the smallest checks that cover the change. For Day 7 persistence or API work, use:

```bash
npm run test:persistence
npm run lint -- <edited-files>
npx tsc --noEmit
```

For UI work, also exercise `/day-7` in a real browser at desktop and mobile widths. Check drawer behavior, keyboard focus, 44×44 px interactive targets, and horizontal overflow.

Before integrating a completed day, run:

```bash
npm run build
git diff --check
```

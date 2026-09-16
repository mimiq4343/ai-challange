# Day 10: context strategies

- `/day-10` switches between Sliding Window, Sticky Facts and Branching without summaries.
- Sliding physically stores only the last 6 messages.
- Sticky Facts refreshes a strict JSON `goal/constraints/preferences/decisions/agreements` after every user message and sends the facts plus the last 6 messages.
- Branching records an immutable checkpoint, creates `Ветка A` and `Ветка B` and isolates their continuations.
- Day 10 state lives in its own `SqliteContextStrategyStore` inside `data/chat.sqlite`; Day 7–9 are unchanged.
- Real benchmark: Sliding Q6/S0, 201 prompt tokens; Facts Q10/S10, 309 prompt + 2463 overhead; Branching Q10/S10, 276 prompt. Model `deepseek-v4-flash`.
- Focused gate: `npm run test:context-strategies`.

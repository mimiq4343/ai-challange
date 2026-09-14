# Day 10: стратегии контекста

- `/day-10` переключает Sliding Window, Sticky Facts и Branching без summary.
- Sliding физически хранит только последние 6 сообщений.
- Sticky Facts обновляет строгий JSON `goal/constraints/preferences/decisions/agreements` после каждого user message и передаёт facts + последние 6 сообщений.
- Branching фиксирует immutable checkpoint, создаёт `Ветка A` и `Ветка B` и изолирует их продолжения.
- Day 10 state хранит отдельный `SqliteContextStrategyStore` в `data/chat.sqlite`; Day 7–9 не меняются.
- Реальный benchmark: Sliding Q6/S0, 201 prompt tokens; Facts Q10/S10, 309 prompt + 2463 overhead; Branching Q10/S10, 276 prompt. Модель `deepseek-v4-flash`.
- Focused gate: `npm run test:context-strategies`.

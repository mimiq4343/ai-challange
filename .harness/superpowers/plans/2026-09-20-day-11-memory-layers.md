# Day 11 Memory Layers Implementation Plan

**Goal:** Разделить память агента на STM, WM и LTM с раздельным хранением,
явной маршрутизацией записи, наблюдаемым вкладом каждого слоя в промпт и
тумблерами слоёв.

**Spec:** `.harness/superpowers/specs/2026-09-20-day-11-memory-layers-design.md`

**Tech Stack:** Next.js 16.3.4, React 19.2.8, TypeScript 5, Node.js `node:sqlite`,
Tailwind CSS 4, `@huggingface/transformers` 4.2.0, Phosphor Icons, `node:test`
через `tsx`.

## Глобальные ограничения

- Работа только в ветке `day-11`, созданной от `day-8`.
- `/day-6`, `/day-7`, `/day-8`, `/api/chat`, `/api/conversations/*` и
  `/api/token-experiments/*` сохраняют поведение.
- Таблицы Day 11 именуются с префиксом `memory_`.
- Обмен сохраняется одной транзакцией после полного стрима; сбой роутера не
  откатывает обмен.
- Внешние вызовы без retry; секреты только в `.env.local`.
- Каждый source-файл меньше 800 строк.
- `main` и remote не меняются без отдельной команды пользователя.

## Этапы

### 1. Хранилище и контракты

- `src/lib/sqlite-database.ts` — `getChatDatabase()` и `openChatDatabase(path)`
  с `PRAGMA foreign_keys = ON`, `journal_mode = WAL`, `timeout = 5000`.
- `src/lib/conversation-store.ts` — конструктор принимает `DatabaseSync`;
  `getConversationStore()` использует общее соединение. Поведение и схема Day 7
  и Day 8 не меняются.
- `src/lib/memory-types.ts` — `MemoryLayer`, `LongTermKind`, `WorkingSlotKind`,
  `MemoryWrite`, `WorkingTask`, `MemoryLayerToggles`, `MemoryLayerTokens`,
  `MemoryExchangeUsage`, `ConversationMemorySnapshot`.
- `src/lib/memory-store.ts` — `SqliteMemoryStore`: создание таблиц,
  `listLongTerm`, `upsertLongTerm`, `deleteLongTerm`, `getActiveTask`,
  `upsertTask`, `closeTask`, `addSlot`, `deleteSlot`, `listWrites`,
  `saveExchangeMemoryUsage`, `applyRouterResult` в одной транзакции.
- `tests/memory-store.test.ts` — upsert по `(kind, key)`, каскад при удалении
  диалога, единственная активная задача, журнал записей.

### 2. Композиция промпта

- `src/lib/memory-composer.ts` — `composeMemoryPrompt` возвращает `messages`,
  `layerTokens`, `includedLongTermIds`, `includedSlotIds`, `stmMessageCount`;
  бюджеты LTM 2 000 и WM 1 000 токенов, окно STM 8 сообщений.
- `src/lib/token-counter.ts` — `countLayeredPrompt` считает префиксные
  разности для `system`, `+LTM`, `+WM`, `+STM`, `+request`.
- `tests/memory-composer.test.ts` — порядок блоков, отсечение по бюджету,
  нулевой вклад выключенного слоя, монотонность префиксов.

### 3. Роутер памяти

- `src/lib/memory-router-llm.ts` — не-стримовый вызов провайдера с
  `response_format: json_object`, ограниченный `max_tokens`, возвращает текст и
  `ProviderTokenUsage`.
- `src/lib/memory-router.ts` — системный промпт с правилами маршрутизации,
  парсинг и валидация JSON, нормализация записей, расчёт стоимости через
  `calculateDeepSeekCost`.
- `tests/memory-router.test.ts` — валидный ответ, мусор, неизвестный слой,
  пустой список записей.

### 4. Агент

- `src/lib/memory-chat-agent.ts` — `MemoryChatAgent.respond(conversationId,
  content, layers, signal)`: снимок памяти, композиция, `assertContextFits`,
  стрим, в `flush` — `saveExchange`, `saveExchangeMemoryUsage`, роутер,
  `applyRouterResult`.
- `tests/memory-chat-agent.test.ts` — выключенный слой отсутствует в промпте,
  сбой роутера сохраняет обмен, записи роутера попадают в нужные таблицы.

### 5. API

- `src/app/api/conversations/[id]/memory-messages/route.ts` — валидация тела,
  заголовки `X-Token-*` и `X-Memory-*`, обработка `ContextLimitError`,
  `ConversationNotFoundError`, `ChatAgentError`.
- `src/app/api/memory/long-term/route.ts` и `[id]/route.ts` — список, ручное
  добавление, удаление.
- `src/app/api/conversations/[id]/memory/route.ts` — снимок памяти диалога.
- `src/app/api/conversations/[id]/memory/task/route.ts` и
  `.../slots/route.ts`, `.../slots/[slotId]/route.ts` — мутации WM.

### 6. Интерфейс

- `src/components/conversation-workspace.tsx` — пропы `messageRoute`,
  `requestBodyExtra`, `inputFooter`, событие `onResponseHeaders`. Поведение
  Day 7 и Day 8 по умолчанию не меняется.
- `src/components/memory-telemetry-bar.tsx` — компактная строка токенов под
  полем ввода с сегментированным баром.
- `src/components/memory-inspector.tsx` — три секции слоёв с тумблерами,
  счётчиками, CRUD и журналом записей.
- `src/components/day11-workspace.tsx` — состояние слоёв, загрузка снимка
  памяти, интеграция инспектора и телеметрии, мобильный bottom sheet.
- `src/app/day-11/page.tsx`, ссылка `Day 11` в `site-header.tsx`.

### 7. Проверка и документация

- `package.json` — скрипт `test:memory`.
- `npm run test:memory`, `npm run test:persistence`, `npm run test:tokens`.
- `npm run lint -- <изменённые файлы>`, `npx tsc --noEmit`.
- Браузер: `/day-11` на десктопе и мобильной ширине, тумблеры, CRUD, drawer,
  отсутствие горизонтального overflow.
- Живой сценарий влияния LTM на ответ в новом диалоге.
- README ветки, `.harness/memory/day-11.md`, индексы `.harness/README.md` и
  `.harness/memory/MEMORY.md`.

## Карта файлов

Новые: `sqlite-database.ts`, `memory-types.ts`, `memory-store.ts`,
`memory-composer.ts`, `memory-router.ts`, `memory-router-llm.ts`,
`memory-chat-agent.ts`, шесть route-файлов, `memory-telemetry-bar.tsx`,
`memory-inspector.tsx`, `day11-workspace.tsx`, `app/day-11/page.tsx`, четыре
тестовых файла.

Изменяются: `conversation-store.ts`, `token-counter.ts`,
`conversation-workspace.tsx`, `site-header.tsx`, `package.json`, `README.md`.

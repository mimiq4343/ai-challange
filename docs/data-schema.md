# Схема данных

Все данные хранятся локально в SQLite через встроенный `node:sqlite`. Файлы
лежат в `data/` и не коммитятся (`data/*.sqlite`, `-wal`, `-shm` в
`.gitignore`). Таблицы объявлены `STRICT`; внешние ключи включены
(`PRAGMA foreign_keys = ON`), журнал — WAL. Схемы создаются идемпотентно
(`CREATE TABLE IF NOT EXISTS`) при открытии хранилища, отдельного шага миграции
нет.

`openChatDatabase()` в `src/lib/sqlite-database.ts` держит одно общее соединение
на файл. Так несколько хранилищ работают с одним WAL без второго writer.

## Файлы

| Файл | Содержимое | Кто создаёт |
| --- | --- | --- |
| `data/chat.sqlite` | диалоги, память, профили, задачи, инварианты, MCP, планировщик, пайплайн, RAG-чат | хранилища Day 7–25 |
| `data/documents.sqlite` | индекс Day 21 (эмбеддинги Nemotron, 2048 измерений) | `npm run documents:index` |
| `data/rag-documents.sqlite` | индекс Недели 6 для Day 22–28 (E5, 384 измерения) | `npm run rag:index` |
| `data/dev-assistant.sqlite` | индекс документации проекта Day 31 (E5, 384 измерения) | `npm run dev-assistant:index` |

Путь `chat.sqlite` можно переопределить переменной `CHAT_DATABASE_PATH` (её
читает хранилище стратегий контекста). Тесты используют временные файлы.

## Диалоги — `conversation-schema.ts`

DDL полностью приведён в `src/lib/conversation-schema.ts`.

- `conversations` — `id TEXT` (UUID), `title`, `created_at`, `updated_at`.
- `messages` — `conversation_id` → `conversations(id) ON DELETE CASCADE`,
  `role IN ('user', 'assistant')`, `content`. Порядок — по `id`.
- `exchange_usage` — токены и стоимость одного обмена: локальный подсчёт
  (`system_tokens`, `history_tokens`, `request_tokens`) и provider usage
  (`provider_*_tokens`, `cache_*_tokens`). Здесь же `source IN ('provider',
  'estimated')` и `cost_micros_usd`. Связана с `assistant_message_id`.
- `conversation_summaries` — неизменяемые чекпоинты Day 9: число
  сжатых сообщений кратно 10, уникальность
  `(conversation_id, summarized_through_message_id)`.
- `exchange_compression` — экономия токенов на каждом сжатом обмене.
- `overflow_runs` — результаты эксперимента с переполнением Day 8, outcome
  `rejected | truncated | accepted | network_error`.

Пара `user + assistant` записывается одной транзакцией только после полного
ответа. Удаление диалога каскадно удаляет сообщения и все зависимые строки.

## Память, профили, задачи, инварианты — `memory-schema.ts`

`src/lib/memory-schema.ts` создаёт таблицы Day 11–15 и выполняет идемпотентные
миграции Day 11 → Day 12.

- `memory_profiles`, `memory_profile_constraints` — профили пользователя и
  их ограничения; ровно один активный профиль.
- `memory_long_term` — долговременная память профиля, уникальность
  `(profile_id, kind, key)`.
- `memory_working_tasks`, `memory_working_slots` — рабочая память диалога.
- `memory_writes` — журнал записей роутера памяти с причиной и слоем.
- `memory_exchange_usage` — вклад слоёв памяти в токены обмена.
- `task_runs`, `task_steps`, `task_events`, `task_proposals` — автомат задачи
  Day 13–15. Частичный уникальный индекс допускает одну живую задачу на профиль.
- `memory_invariants`, `memory_invariant_proposals`,
  `memory_invariant_events` — инварианты проекта Day 14.

## Остальные таблицы `chat.sqlite`

| Таблицы | Модуль | День |
| --- | --- | --- |
| `context_sessions`, `context_messages`, `context_checkpoints`, `context_branches`, `context_benchmark_runs` | `context-strategy-store.ts` | Day 10 |
| `compression_runs` | `compression-run-store.ts` | Day 9 |
| `mcp_servers` (уникальность `(profile_id, url)`) | `mcp-store.ts` | Day 16 |
| `scheduler_jobs`, `scheduler_runs` | `scheduler-schema.ts` | Day 18 |
| `pipeline_search_results`, `pipeline_summaries`, `pipeline_reports` | `pipeline-store.ts` | Day 19 |
| `orchestration_runs`, `orchestration_calls` | `orchestration-run-store.ts` | Day 20 |
| `rag_chat_exchanges` | `rag-chat-store.ts` | Day 25 |

`scheduler_jobs` хранит репозиторий, интервал и статус `active | stopped`, а
`scheduler_runs` — запуски с lease для фонового worker. Обе таблицы
каскадно удаляются вместе с профилем. `rag_chat_exchanges` хранит снимки
памяти задачи и полного ответа с источниками для каждого сообщения ассистента.

## Индексы документов — `document-store.ts`

Все три индекса (Day 21, Неделя 6, Day 31) используют одну схему
`SqliteDocumentStore`:

- `document_index` — одна строка (`singleton = 1`) с JSON-отчётом индексации:
  ID снимка, модель, размерность, хеш корпуса и сравнение стратегий.
- `document_chunks` — чанки обеих стратегий `fixed` и `structural`: путь
  источника, раздел, текст, смещения и строки, хеши и вектор `embedding`
  (BLOB float32, длина `dimensions * 4`).

Индекс пересоздаётся целиком одной транзакцией. Читатель видит согласованный
снимок отчёта и чанков.

# Day 31 · полные ответы /help

Прогон 2026-10-17 через `handleHelpCommand` с реальными `.env.local`, LLM и stdio
MCP-сервером проекта; индекс `573a2b78-d58b-4e39-b835-debe97f4a082`. Ответы модели
приведены без правок. Ответ 1 — детерминированная справка без LLM; в ней одна
строка показана после исправления (см. [отчёт](help-quality.md)).

## 1. `/help`

Статус: done · 1 с · вызовов MCP: 1

Вызовы инструментов:

- `git_branch({})`

**Flash Dev — ассистент разработчика.** Сейчас ветка `day-31`, HEAD `8c88efaaea52`.

Спросите командой `/help <вопрос о проекте>`. Модель сама выбирает MCP-инструменты проекта:

- `search_docs` — поиск по README.md, AGENTS.md, docs/ и SQL-схемам; ответ ссылается на найденные фрагменты;
- `git_branch` и `git_status` — ветка, HEAD и изменённые файлы;
- `list_files` — структура каталогов по отслеживаемым файлам;
- `git_diff` — изменения рабочего дерева относительно HEAD.

Например: `/help Как устроен проект и где лежат API-маршруты?`

## 2. `/help Как устроен проект и где лежат API-маршруты?`

Статус: done · 12.1 с · вызовов MCP: 3

Вызовы инструментов:

- `search_docs({"query":"структура проекта, устройство, основные каталоги","limit":6})`
  - S1 docs/README.md · Документация Flash Chat
  - S2 README.md · AI Advent Challenge #9 / Структура Day 15
  - S3 docs/architecture.md · Архитектура Flash Chat / Каталоги
  - S4 README.md · AI Advent Challenge #9 / Структура Day 13
  - S5 README.md · AI Advent Challenge #9 / Структура Day 12
  - S6 README.md · AI Advent Challenge #9 / Хронология / Day 31 · Ассистент разработчика — ветка `day-31`, страница `/day-31`
- `search_docs({"query":"API маршруты routes endpoints","limit":6})`
  - S7 docs/api.md · HTTP API
  - S8 README.md · AI Advent Challenge #9 / SQLite и API Day 7–24
  - S9 docs/architecture.md · Архитектура Flash Chat / Каталоги
  - S10 docs/architecture.md · Архитектура Flash Chat / Слои запроса
  - S11 docs/api.md · HTTP API / MCP (Day 16–20)
  - S12 README.md · AI Advent Challenge #9 / Запуск
- `git_branch({})`

#### Устройство Flash Chat

##### Каталоги [S3]

```text
src/
  app/            страницы дней и маршруты API (App Router)
    page.tsx      Day 1: лендинг-чат
    day-N/page.tsx серверная страница дня: загрузка данных + workspace
    api/          тонкие route.ts: разбор запроса и вызов модуля из lib
  components/     клиентские компоненты ("use client"): workspace дня, панели, карточки
  lib/            доменная логика, агенты, хранилища, конфигурация
scripts/          CLI: индексация, бенчмарки, MCP-серверы, фоновый worker
tests/            тесты node:test; tests/browser — браузерные сценарии
docs/             документация проекта
deploy/           systemd-юниты и Caddy для MCP-сервера и планировщика
data/             локальные SQLite, модели и отчёты (не в git)
.harness/         рабочие материалы агентов: память, отчёты, планы
```

Документация в `docs/` разбита на: архитектура, HTTP API, схема данных, MCP, разработка, ассистент разработчика [S1].

##### Где лежат API-маршруты

**Все маршруты — в `src/app/api/**/route.ts`**, выполняются на сервере Node.js [S7]. Правило слоёв: клиент делает `fetch` в `/api/...`, тонкий `route.ts` вызывает обработчик из `src/lib`, почти все маршруты объявляют `runtime = "nodejs"` (нужны `node:sqlite`, ФС или дочерние процессы) [S10].

Ключи провайдеров, история и контекст **никогда не приходят от клиента** — сервер загружает их сам по ID диалога, профиля или индекса [S7]. Ошибки — JSON `{ "error": "..." }` со статусами: 400 / 404 / 409 / 413 / 502 / 504 [S7].

###### Примеры маршрутов (поздние дни)

Группа MCP и планировщика [S11]:

| Метод | Путь |
| --- | --- |
| GET, POST | `/api/mcp-servers` |
| DELETE | `/api/mcp-servers/:id` |
| POST | `/api/mcp-servers/:id/discover` |
| POST | `/api/conversations/:id/mcp-messages` |
| POST | `/api/conversations/:id/scheduled-messages` |
| GET | `/api/schedules` |
| POST | `/api/schedules/:id/stop` |
| POST | `/api/conversations/:id/pipeline-messages` |
| GET | `/api/pipeline/reports` |

Другие дни добавляют свои группы: `api/profiles/` (Day 12) [S5], `api/tasks/` и `api/conversations/[id]/task-messages/` (Day 13) [S4], `api/tasks/[id]/approve-plan/` (Day 15) [S2].

##### Ветки и страницы

По git-инструментам: текущая ветка — **`day-31`**, HEAD `8c88efa`, последний коммит «docs(readme): mark day 25 integrated and add day 28 scope».

По документации: в `main` есть `/` и `/day-5` … `/day-25`, а в ветке `day-31` — ещё `/day-31`; страницы Day 2–4 существуют только в своих ветках [S3]. Сам этот ассистент (`/help`) реализован в ветке `day-31` [S6].

Индекс документации актуален (`stale=false`), пересоздавать не нужно.

Хотите, уточню по конкретному дню или группе маршрутов?

## 3. `/help Какие таблицы SQLite хранят историю диалогов и что происходит при удалении диалога?`

Статус: done · 7.8 с · вызовов MCP: 2

Вызовы инструментов:

- `search_docs({"query":"таблицы SQLite история диалогов сообщения схема","limit":6})`
  - S1 src/lib/conversation-schema.ts · ensureConversationSchema
  - S2 README.md · AI Advent Challenge #9 / Хронология / Day 9 · Сжатие истории — страница `/day-9`
  - S3 docs/data-schema.md · Схема данных / Диалоги — `conversation-schema.ts`
  - S4 docs/data-schema.md · Схема данных
  - S5 README.md · AI Advent Challenge #9 / SQLite и API Day 7–24
  - S6 docs/data-schema.md · Схема данных / Остальные таблицы `chat.sqlite`
- `search_docs({"query":"удаление диалога каскадное удаление сообщений cascade delete conversation","limit":6})`
  - S7 docs/data-schema.md · Схема данных / Диалоги — `conversation-schema.ts`
  - S8 docs/api.md · HTTP API / Чат и диалоги (Day 1–10)
  - S9 README.md · AI Advent Challenge #9 / SQLite и API Day 7–24
  - S10 docs/api.md · HTTP API / Память, профили, задачи и инварианты (Day 11–15)
  - S11 docs/api.md · HTTP API / Память, профили, задачи и инварианты (Day 11–15)
  - S12 src/lib/conversation-schema.ts · FirstStatement

Кратко по документации.

##### Таблицы истории диалогов (файл `data/chat.sqlite`)
Основной модуль — `src/lib/conversation-schema.ts`, функция `ensureConversationSchema` создаёт таблицы диалогов, сообщений и метрик Day 7–10 [S1]:

- `conversations` — `id TEXT` (UUID), `title`, `created_at`, `updated_at` [S3][S12];
- `messages` — `conversation_id` → `conversations(id) ON DELETE CASCADE`, `role IN ('user','assistant')`, `content`, порядок по `id`; есть индекс `messages_conversation_id_id(conversation_id, id)` [S3][S12]. Пара `user + assistant` пишется одной транзакцией только после полного ответа [S3];
- `exchange_usage` — токены/стоимость обмена (локальный подсчёт + provider usage), `source IN ('provider','estimated')`, `cost_micros_usd`, привязка по `assistant_message_id` [S3];
- `conversation_summaries` — immutable-чекпоинты Day 9 (число сжатых сообщений кратно 10, уникальность `(conversation_id, summarized_through_message_id)`) [S3];
- `exchange_compression` — экономия токенов на каждом сжатом обмене [S3];
- `overflow_runs` — результаты эксперимента с переполнением Day 8 [S3];
- `compression_runs` (Day 9), а также таблицы памяти и контекстных стратегий живут в отдельных модулях [S6].

Хранилище: SQLite через встроенный `node:sqlite`, таблицы `STRICT`, `PRAGMA foreign_keys = ON`, журнал WAL, схемы создаются идемпотентно, отдельной миграции нет [S4][S5]. Полная история при сжатии Day 9 остаётся в SQLite [S2].

##### Что происходит при удалении диалога
- `DELETE /api/conversations/:id` удаляет диалог каскадно [S8];
- `messages.conversation_id` объявлен с `ON DELETE CASCADE`, поэтому сообщения диалога удаляются вместе с ним [S3][S12][S5];
- `exchange_usage` тоже ссылается на `conversations(id) ON DELETE CASCADE` (и на `messages(id) ON DELETE CASCADE` по `assistant_message_id`) [S12];
- по README, таблицы памяти — `memory_*` (в т.ч. `memory_working_slots`, `memory_writes`, `memory_exchange_usage`) — «удаляются вместе с диалогом через каскад» [S9].

Оговорки: фрагмент docs/data-schema.md оборван на «…каскадно удаляет сообще…» [S3], но DDL в схеме и README говорят то же самое [S12][S5][S9]. Индекс документации актуален (`stale=false`), git-инструменты не вызывались — вопрос был про схему данных.

## 4. `/help Какая сейчас ветка и какие файлы изменены?`

Статус: done · 5.1 с · вызовов MCP: 2

Вызовы инструментов:

- `git_branch({})`
- `git_status({})`

##### Ветка

По `git_branch`: **`day-31`** (не detached), HEAD — `8c88efaaea52`.
Последний коммит: `docs(readme): mark day 25 integrated and add day 28 scope` (2026-10-12 10:48 +05:00).
Upstream не настроен (`upstream: null`), поэтому ahead/behind неизвестны.

##### Изменения

По `git_status`: дерево не чистое — всего **29** позиций (список не обрезан).

**Изменённые (отслеживаемые, 8):**
- `.gitignore`
- `.harness/README.md`
- `.harness/memory/MEMORY.md`
- `README.md`
- `package.json`
- `src/components/day-nav-menu.tsx`
- `src/components/mcp-tool-card.tsx`
- `src/lib/mcp-tool-chat-agent.ts`

**Неотслеживаемые (21):**
- каталоги: `data/`, `docs/`, `src/app/api/dev-assistant/`, `src/app/day-31/`
- harness/scripts: `.harness/memory/day-31.md`, `scripts/index-dev-assistant.ts`, `scripts/project-mcp-server.ts`
- компоненты и lib: `src/components/dev-assistant-workspace.tsx`, `src/lib/dev-assistant-config.ts`, `dev-assistant-http.ts`, `dev-assistant-questions.json`, `dev-assistant-sources.ts`, `project-docs.ts`, `project-git.ts`, `project-mcp-client.ts`, `project-mcp-server.ts`, `project-tool-schemas.ts`
- тесты: `tests/dev-assistant-agent.test.ts`, `tests/dev-assistant-http.test.ts`, `tests/project-git.test.ts`, `tests/project-mcp-server.test.ts`

Уточнение: в `git_status` неотслеживаемые каталоги показаны как каталоги, без перечисления файлов внутри. Если нужен состав (например, `docs/` или `src/app/day-31/`) — скажи, посмотрю через `list_files`.

## 5. `/help Какие инструменты есть у MCP-сервера проекта и как он подключается?`

Статус: done · 8.8 с · вызовов MCP: 2

Вызовы инструментов:

- `search_docs({"query":"MCP-сервер проекта инструменты поиска документации, конфигурация подключения","limit":6})`
  - S1 docs/mcp.md · MCP в Flash Chat / Собственные серверы / MCP-сервер проекта (stdio) — Day 31
  - S2 docs/dev-assistant.md · Ассистент разработчика — Day 31 / Поток запроса
  - S3 README.md · AI Advent Challenge #9 / Хронология / Day 20 · Оркестрация MCP-серверов — страница `/day-20`
  - S4 docs/dev-assistant.md · Ассистент разработчика — Day 31 / Конфигурация и безопасность
  - S5 docs/mcp.md · MCP в Flash Chat / Клиенты и агенты
  - S6 docs/mcp.md · MCP в Flash Chat / Собственные серверы / HTTP-сервер `npm run mcp:server`
- `search_docs({"query":"dev-assistant MCP server tools search_docs git_branch list_files подключение в конфиге","limit":6})`
  - S7 docs/api.md · HTTP API / Ассистент разработчика (Day 31)
  - S8 docs/mcp.md · MCP в Flash Chat / Собственные серверы / MCP-сервер проекта (stdio) — Day 31
  - S9 README.md · AI Advent Challenge #9 / Хронология / Day 31 · Ассистент разработчика — ветка `day-31`, страница `/day-31`
  - S10 README.md · AI Advent Challenge #9 / Хронология / Day 31 · Ассистент разработчика — ветка `day-31`, страница `/day-31`
  - S11 docs/dev-assistant.md · Ассистент разработчика — Day 31 / Команда `/help`
  - S12 README.md · AI Advent Challenge #9 / Хронология / Day 16 · Подключение MCP — страница `/day-16`

##### MCP-сервер проекта (stdio, Day 31)

**Что это:** `scripts/project-mcp-server.ts` → фабрика `createProjectMcpServer` в `src/lib/project-mcp-server.ts`. Сервер **не слушает порт**: Next.js запускает его дочерним процессом на один запрос `/help` (`withProjectMcpTools` в `src/lib/project-mcp-client.ts`) и общается через stdin/stdout [S1][S8].

**Подключение:**
1. `POST /api/dev-assistant/help` с телом `{ "command": "/help …" }` (единственное поле, до 16 КБ) [S7].
2. `McpToolChatAgent` в режиме `project` стартует stdio-сервер и получает каталог инструментов [S2].
3. Tool-loop: до 6 раундов, до 4 вызовов за раунд и до 10 всего, затем финальный раунд без инструментов; общий таймаут 240 с. Аргументы валидируются схемами `projectToolSchemas` [S2].
4. Ответ — поток NDJSON (`tool-start`, `tool-result`, `text`, `done`); дочерний процесс завершается вместе с запросом [S2].

**Изоляция:** процесс видит только рабочую копию dev-сервера, получает от родителя безопасный минимум окружения SDK (`PATH`, `HOME`, …) без ключей LLM, сеть не открывает [S1][S4][S9].

##### Инструменты (все только для чтения) [S1][S8]

| Инструмент | Аргументы | Результат |
| --- | --- | --- |
| `search_docs` | `query`, `limit` 1–8 (по умолчанию 5) | фрагменты документации с id `S1…`, `indexId`, флаг `stale` |
| `git_branch` | — | ветка, detached, HEAD (12 символов), upstream, ahead/behind, последний коммит |
| `git_status` | — | изменённые, переименованные, конфликтные и неотслеживаемые файлы (до 200) |
| `list_files` | `path` | подкаталоги с числом отслеживаемых файлов и файлы каталога (до 300 записей) |
| `git_diff` | `path` | diff относительно HEAD (неотслеживаемые файлы не входят) |

Что ищет RAG: `README.md`, `AGENTS.md`, `docs/` и SQL-схемы `src/lib/*-schema.ts`; индекс — в `data/dev-assistant.sqlite` [S10].

##### Важное различие

Не путать с другими MCP-серверами проекта: HTTP-сервер `npm run mcp:server` (`127.0.0.1:3001`, Streamable HTTP: `/mcp`, `/mcp/scheduler`, `/mcp/pipeline`) [S6] и реестр `ORCHESTRATION_SERVERS` Day 20 [S3][S5].

> Индекс документации свежий (`stale=false`), предупреждений нет.

## 6. `/help Что лежит в каталоге src/lib и как называются модули хранилищ?`

Статус: done · 8 с · вызовов MCP: 2

Вызовы инструментов:

- `list_files({"path":"src/lib"})`
- `search_docs({"query":"модули хранилищ storage schema src/lib"})`
  - S1 docs/dev-assistant.md · Ассистент разработчика — Day 31 / Индекс документации
  - S2 docs/data-schema.md · Схема данных / Остальные таблицы `chat.sqlite`
  - S3 README.md · AI Advent Challenge #9 / Хронология / Day 31 · Ассистент разработчика — ветка `day-31`, страница `/day-31`
  - S4 docs/architecture.md · Архитектура Flash Chat / Соглашения об именах в `src/lib`
  - S5 src/lib/scheduler-schema.ts · ImportDeclaration

##### Каталог `src/lib`

По `list_files("src/lib")`: **124 отслеживаемых файла**, все — плоский список файлов, подкаталогов в `src/lib` нет. Это модули приложения: агенты, HTTP-обработчики, конфиги, типы, бенчмарки, MCP-серверы, плюс JSON-данные (`document-corpus-manifest.json`, `document-questions.json`, `rag-questions.json`).

##### Как называются модули хранилищ

По соглашениям проекта суффикс `*-store.ts` — «хранилище SQLite с транзакциями», `*-schema.ts` — «DDL таблиц и идемпотентные миграции» [S4].

**`*-store.ts` в `src/lib`** (по `list_files`):
- `conversation-store.ts`, `memory-store.ts`, `profile-store.ts`, `task-store.ts`
- `document-store.ts`, `mcp-store.ts`, `invariant-store.ts`
- `context-strategy-store.ts`, `compression-run-store.ts`, `orchestration-run-store.ts`
- `pipeline-store.ts`, `scheduler-store.ts`, `rag-chat-store.ts`

**`*-schema.ts`** (по `list_files`): `conversation-schema.ts`, `memory-schema.ts`, `scheduler-schema.ts`.

Привязка модулей к таблицам `chat.sqlite` подтверждается документацией [S2]: например, `context-strategy-store.ts` — таблицы `context_sessions`, `context_messages`, `context_checkpoints`, `context_branches`, `context_benchmark_runs` (Day 10); `compression-run-store.ts` — `compression_runs` (Day 9); `mcp-store.ts` — `mcp_servers` (Day 16); `scheduler-schema.ts` — `scheduler_jobs`, `scheduler_runs` (Day 18); `pipeline-store.ts` — `pipeline_search_results`, `pipeline_summaries`, `pipeline_reports` (Day 19); `orchestration-run-store.ts` — `orchestration_runs`, `orchestration_calls` (Day 20); `rag-chat-store.ts` — `rag_chat_exchanges` (Day 25) [S2].

Индекс документации актуален (`stale: false`).

## 7. `/help Какие проверки нужно запустить перед вливанием дня в main?`

Статус: done · 11.1 с · вызовов MCP: 4

Вызовы инструментов:

- `search_docs({"query":"проверки перед вливанием в main: lint, тесты, сборка, pre-commit","limit":6})`
  - S1 docs/development.md · Разработка / Проверки перед сдачей
  - S2 README.md · AI Advent Challenge #9 / Проверка Day 18
  - S3 README.md · AI Advent Challenge #9 / Проверка Day 16
  - S4 README.md · AI Advent Challenge #9 / Проверка Day 8–10
  - S5 README.md · AI Advent Challenge #9 / Проверка Day 13
  - S6 README.md · AI Advent Challenge #9 / Проверка Day 11
- `search_docs({"query":"правила работы с ветками, коммиты, merge, CI","limit":6})`
  - S7 docs/development.md · Разработка / Ветки и коммиты
  - S8 docs/api.md · HTTP API / Ассистент разработчика (Day 31)
  - S9 docs/api.md · HTTP API / Чат и диалоги (Day 1–10)
  - S10 README.md · AI Advent Challenge #9 / Структура веток
  - S11 docs/README.md · Документация Flash Chat
  - S12 README.md · AI Advent Challenge #9 / Хронология / Day 21 · Индексация документов — страница `/day-21`
- `git_branch({})`
- `git_status({})`

##### Базовый чек-лист (docs/development.md)

Минимальный набор для изменений API и хранилищ [S1]:

```bash
npm run test:persistence
npm run lint -- <изменённые файлы>
npx tsc --noEmit
```

**Перед вливанием дня в `main` дополнительно** [S1]:

```bash
npm run build
git diff --check
```

Для UI-правок — живая проверка в браузере на десктопной и мобильной ширине: drawer, фокус с клавиатуры, цели 44×44 px, отсутствие горизонтальной прокрутки [S1].

В README аналогичные чек-листы по дням включают более широкий набор тестов и `npm run lint` целиком (например, Day 16 — `test:mcp`, `test:persistence`, `lint`, `tsc`, `build`, `git diff --check`; Day 18 — `test:scheduler` и др.) [S2][S3][S4]. Для Day 31 отдельного пункта в найденных фрагментах нет — при необходимости уточните поиском по хронологии Day 31.

##### Организационное

- Каждый день разрабатывается в ветке `day-N` от `main` и вливается в `main` **только после согласования** [S7].
- Коммиты — Conventional Commits: `feat(day-31): …`, `docs(readme): …` [S7].
- В git не должны попадать `.env.local`, ключи, `data/*.sqlite*`, модели в `data/models/` и JSON-отчёты бенчмарков [S7].

##### Состояние репозитория

По `git_branch`: ветка `day-31`, HEAD `8c88efaaea52`, upstream не настроен (ahead/behind неизвестны), последний коммит — `docs(readme): mark day 25 integrated and add day 28 scope`.

По `git_status`: рабочее дерево **грязное** — 29 позиций: изменены `.gitignore`, `README.md`, `package.json`, три `src/**`-файла; неотслеживаются, в частности, `data/`, `docs/`, `src/app/day-31/`, `src/app/api/dev-assistant/`, `src/lib/project-*.ts`, `tests/dev-assistant-*.test.ts`, `tests/project-git.test.ts`.

Практический вывод: до вливания нужно сначала закоммитить (или исключить через `.gitignore`) неотслеживаемые файлы — по `git_status` среди них есть каталог `data/`, который по правилам проекта в git не попадает [S7].

## 8. `/help Как развернуть проект в Kubernetes через Helm?`

Статус: done · 14 с · вызовов MCP: 6

Вызовы инструментов:

- `search_docs({"query":"развернуть проект в Kubernetes через Helm"})`
  - S1 docs/mcp.md · MCP в Flash Chat / Собственные серверы / MCP-сервер проекта (stdio) — Day 31
  - S2 README.md · AI Advent Challenge #9 / Хронология / Day 31 · Ассистент разработчика — ветка `day-31`, страница `/day-31`
  - S3 docs/README.md · Документация Flash Chat
  - S4 README.md · AI Advent Challenge #9 / Хронология / Day 17 · Первый инструмент MCP — страница `/day-17`
  - S5 docs/api.md · HTTP API / Память, профили, задачи и инварианты (Day 11–15)
- `search_docs({"query":"Docker сборка запуск деплой"})`
  - S6 README.md · AI Advent Challenge #9 / Запуск / Фоновые процессы Day 18
  - S7 README.md · AI Advent Challenge #9 / Хронология / Day 20 · Оркестрация MCP-серверов — страница `/day-20`
  - S8 docs/dev-assistant.md · Ассистент разработчика — Day 31 / Поток запроса
  - S9 README.md · AI Advent Challenge #9 / Хронология / Day 20 · Оркестрация MCP-серверов — страница `/day-20`
  - S10 README.md · AI Advent Challenge #9 / Запуск
- `search_docs({"query":"Docker образ контейнеризация kubernetes helm charts k8s"})`
  - S11 README.md · AI Advent Challenge #9 / Структура Day 21
  - S12 README.md · AI Advent Challenge #9 / Хронология / Day 24 · Цитаты, источники и анти-галлюцинации — ветка `day-24`, страница `/day-24`
  - S13 docs/data-schema.md · Схема данных / Остальные таблицы `chat.sqlite`
  - S14 README.md · AI Advent Challenge #9 / Хронология / Day 21 · Индексация документов — страница `/day-21`
  - S15 README.md · AI Advent Challenge #9 / Хронология / Day 23 · Реранкинг и фильтрация — ветка `day-23`, страница `/day-23`
- `list_files({})`
- `list_files({"path":"deploy"})`
- `search_docs({"query":"продакшн развёртывание сервер systemd службы домен HTTPS"})`
  - S16 README.md · AI Advent Challenge #9 / Структура Day 21
  - S17 docs/mcp.md · MCP в Flash Chat / Собственные серверы / HTTP-сервер `npm run mcp:server`
  - S18 docs/api.md · HTTP API / MCP (Day 16–20)
  - S19 README.md · AI Advent Challenge #9 / Хронология / Day 16 · Подключение MCP — страница `/day-16`
  - S20 README.md · AI Advent Challenge #9 / Структура Day 16

##### Коротко

**В документации проекта нет развёртывания в Kubernetes или через Helm.** Я прочитал доки (`search_docs`) и содержимое репозитория (`list_files`) — ни Helm-чартов, ни манифестов K8s, ни Dockerfile нет. Так что готовой инструкции «kubectl/helm install» я дать не могу — это была бы выдумка.

##### Как проект разворачивают на самом деле

По документации используется схема **npm + systemd + Caddy, без контейнеров**:

- Прямо сказано: «Docker не нужен» для MCP-сервера [S19].
- Каталог `deploy/` (по git-инструменту содержит 3 файла: `flash-mcp.service`, `flash-scheduler.service`, `mcp.Caddyfile`) — это systemd-юниты и конфиг HTTPS-прокси, а не манифесты кластера [S17][S20].
- Для круглосуточной работы применяются unit-файлы `deploy/flash-mcp.service` и `deploy/flash-scheduler.service`: они запускают npm, восстанавливаются после падения и включаются при загрузке ОС; конфигурация привязана к конкретному пути `/data/workspaces/ai-challange`, пользователю `mimiq` и Node.js версии из Homebrew, на другом хосте unit-файлы нужно править [S6].
- Публичный адрес MCP отдаётся Caddy через `deploy/mcp.Caddyfile` (например, `https://mcp.yees.ai`) [S17][S19].
- Обычный запуск приложения локально: `npm install` → `cp .env.example .env.local` → `npm run dev`, секреты — только в `.env.local` на сервере [S10][S6].

##### Что можно сделать вместо Helm

Развёртывание в K8s придётся проектировать самостоятельно (например, написать свой Dockerfile/чарт) — в проекте для этого нет ни заготовок, ни документации, и я не могу выдумывать конкретные команды.

##### Замечание по данным

Индекс документации свежий (`stale=false`), так что отсутствие упоминаний K8s/Helm — это не устаревший индекс, а реальное состояние доков. Если вы знаете, что чарты есть вне отслеживаемых git-файлов, уточните путь — проверю структуру ещё раз.

# Архитектура Flash Chat

Flash Chat — одно Next.js-приложение, в котором каждое задание AI Advent
Challenge #9 живёт на своей странице `/day-N` и в своей ветке `day-N`. Дни
наращивают общий код: новые возможности добавляются отдельными модулями,
а маршруты и API прошлых дней продолжают работать.

## Стек

- Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4.
- Node.js 22.13 или новее; SQLite — встроенный модуль `node:sqlite`, без
  нативных зависимостей.
- LLM подключается через любой OpenAI-совместимый `POST /chat/completions`
  со стримингом SSE. Основная модель — DeepSeek Flash, её лимиты описаны в
  `src/lib/model-profiles.ts`.
- Локальные эмбеддинги — `Xenova/multilingual-e5-small` через
  `@huggingface/transformers` на CPU.
- MCP — `@modelcontextprotocol/sdk` 1.30.1: Streamable HTTP для серверов Day 16–20
  и stdio для MCP-сервера проекта Day 31.

## Каталоги

```text
src/
  app/                страницы дней и маршруты API (App Router)
    page.tsx          Day 1: лендинг-чат
    day-N/page.tsx    серверная страница дня: загрузка данных и workspace
    api/              тонкие route.ts: разбор запроса и вызов модуля из lib
  components/         клиентские компоненты ("use client"): workspace дня, панели, карточки
  lib/                доменная логика, агенты, хранилища, конфигурация
scripts/              CLI: индексация, бенчмарки, MCP-серверы, фоновый worker
tests/                тесты node:test; tests/browser — браузерные сценарии
docs/                 эта документация
deploy/               systemd-юниты и Caddy для MCP-сервера и планировщика
data/                 локальные SQLite, модели и отчёты (не в git)
.harness/             рабочие материалы агентов: память, отчёты, планы
```

Страницы Day 2–4 существуют только в своих ветках; в `main` есть `/`,
`/day-5` … `/day-25`, а в ветке `day-31` — ещё `/day-31`.

## Соглашения об именах в `src/lib`

| Суффикс | Назначение | Пример |
| --- | --- | --- |
| `*-agent.ts` | агент поверх LLM: сборка промпта, вызов модели, проверка ответа | `persistent-chat-agent.ts` |
| `*-store.ts` | хранилище SQLite с транзакциями | `conversation-store.ts` |
| `*-schema.ts` | DDL таблиц и идемпотентные миграции | `memory-schema.ts` |
| `*-config.ts` | версионируемые лимиты, таймауты, промпты | `rag-config.ts` |
| `*-types.ts` | контракты данных между слоями | `rag-types.ts` |
| `*-http.ts` | обработчик HTTP для route.ts: валидация, статусы, поток | `rag-http.ts` |
| `*-benchmark.ts` | воспроизводимые сравнения с отчётом в `data/` | `rag-benchmark.ts` |
| `*-mcp-server.ts` | фабрика MCP-сервера с инструментами | `pipeline-mcp-server.ts` |

Секреты и адреса окружения читаются только на сервере. Поведение (лимиты,
таймауты, модели, промпты) хранится в `*-config.ts`, а не в переменных
окружения.

## Слои запроса

1. Клиентский компонент отправляет `fetch` в `/api/...` и читает ответ:
   текстовый поток, NDJSON-события или JSON.
2. `route.ts` в `src/app/api` вызывает обработчик из `src/lib`; почти все
   маршруты явно объявляют `runtime = "nodejs"`, потому что им нужны
   `node:sqlite`, файловая система или дочерние процессы.
3. Обработчик проверяет тело запроса и создаёт агента через
   `fromEnvironment()`. Обязательные переменные окружения проверяются явно.
4. Агент загружает контекст на сервере: историю из SQLite, память, индекс
   RAG или инструменты MCP. Затем он вызывает LLM через `ChatAgent` или
   собственный tool-loop.
5. Хранилище фиксирует только завершённый обмен `user + assistant` одной
   транзакцией. Обрыв или ошибка потока ничего не сохраняет.

## Основные модули по дням

- **Day 1–6.** `ChatAgent` (`chat-agent.ts`) — стриминговый клиент
  OpenAI-совместимого API и разбор provider usage; компонент `Chat`.
- **Day 7.** `PersistentChatAgent` и `SqliteConversationStore`: история диалогов в
  `data/chat.sqlite`. Перед каждым вызовом LLM история загружается по ID
  диалога.
- **Day 8.** `token-counter.ts`, `token-cost.ts`, `overflow-experiment.ts` —
  локальный подсчёт токенов, стоимость, эксперимент с переполнением.
- **Day 9.** `CompressedChatAgent`, `history-compression.ts`,
  `history-summarizer.ts` — неизменяемые summary-чекпоинты.
- **Day 10.** `ContextStrategyAgent`, `context-strategy-store.ts` — Sliding Window,
  Sticky Facts, ветвление.
- **Day 11–15.** `MemoryChatAgent`, `memory-router.ts`, `memory-composer.ts`.
  Профили (`profile-store.ts`), автомат задачи (`task-machine.ts`,
  `task-store.ts`) и инварианты (`invariant-guard.ts`, `invariant-store.ts`)
  собирает `PersonalizedChatAgent`.
- **Day 16–20.** `mcp-client.ts`, `mcp-store.ts`, `McpToolChatAgent`
  (`mcp-tool-chat-agent.ts`). Планировщик (`scheduler-*.ts`), пайплайн
  (`pipeline-*.ts`) и оркестрация (`mcp-router.ts`, `orchestration-*.ts`).
- **Day 21.** `document-corpus.ts`, `document-chunking.ts`,
  `document-indexer.ts` и `document-store.ts` — корпус, стратегии чанкинга
  fixed/structural, индекс в SQLite.
- **Day 22–25.** `RagAgent` (`rag-agent.ts`) и `RagRefinementAgent` с rewrite
  и reranking. `GroundedRagAgent` возвращает ответ с цитатами,
  `RagChatAgent` — чат с памятью задачи (`rag-task-memory.ts`).
- **Day 31.** `McpToolChatAgent` в режиме `project`, `project-mcp-server.ts`,
  `project-git.ts` и `project-docs.ts` — ассистент разработчика, см.
  [dev-assistant.md](dev-assistant.md).
- **Day 32.** `McpToolChatAgent` в режиме `review` выбирает локальные серверные
  инструменты `review_pr`/`review_changes` (`code-review-agent-tools.ts`).
  Они используют общий `code-review-runner.ts`, immutable Git snapshot и
  RAG по документации и коду. Долгое ревью выполняется в процессе сервера
  без короткого таймаута stdio MCP-сессии. `DevAssistantWorkspace` показывает
  вызовы, прогресс и структурированный отчёт; прежний `/help` остаётся режимом
  `project`. GitHub Action отдельно запускает CLI и публикует комментарий.
  Контракты и ограничения — в [code-review.md](code-review.md).

- **Day 35.** `release-git.ts` фиксирует Git refs и использует сборщик снимков
  Day 32. `release-agent.ts` анализирует diff через `ChatAgent`, проверяет ID
  источников и формирует Markdown. `release-ci.ts` отдельно читает GitHub Actions
  для точного head SHA. Предложения и применение файлов используют Flash Files.
  `ReleaseWorkspace` показывает этапы, AI-отчёт, CI и diff, см. [release.md](release.md).

## Интерфейс

Все страницы используют `SiteHeader` с выпадающим списком дней (`DayNavMenu`)
и визуальную систему Flash Chat: тёмная тема, акцент `accent`, скругления
`rounded-xl`/`rounded-2xl` и интерактивные цели не меньше 44×44 px.
Раскладка резиновая, на всю ширину окна. Тексты интерфейса — на русском.

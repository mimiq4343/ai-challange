# HTTP API

Все маршруты лежат в `src/app/api/**/route.ts` и выполняются на сервере Node.js.
Ключи провайдеров, история и контекст никогда не приходят от клиента: сервер
загружает их сам по ID диалога, профиля или индекса. Ошибки возвращаются как
JSON `{ "error": "..." }` с HTTP-статусом: 400 — неверный запрос, 404 — нет
объекта, 409 — конфликт состояния, 413 — слишком большое тело, 502/504 — сбой
или таймаут провайдера.

## Форматы ответов

- **Текстовый поток** (`text/plain`) — Day 1–15: ответ модели по мере
  генерации. Обмен сохраняется только после полного ответа.
- **NDJSON** (`application/x-ndjson`) — Day 17–20 и Day 31: по одному событию
  JSON в строке: `tool-start`, `tool-result`, `text`, `metadata`, `done`,
  `error`. Успех подтверждает только `done`; обрыв без него — ошибка.
  Клиент читает поток через `consumeMcpChatStream` (`src/lib/mcp-chat-stream.ts`).
- **JSON** — CRUD, RAG Day 22–25, отчёты и бенчмарки.

## Чат и диалоги (Day 1–10)

| Метод | Путь | Назначение |
| --- | --- | --- |
| POST | `/api/chat` | Day 1/6: чат без сохранения, тело `{ messages }` |
| POST | `/api/day5` | Day 5: один запрос к выбранной из конфига модели с метриками |
| GET, POST | `/api/conversations` | Day 7: список и создание диалогов |
| GET, DELETE | `/api/conversations/:id` | диалог с сообщениями; удаление каскадно |
| POST | `/api/conversations/:id/messages` | Day 7: сообщение `{ content }`, текстовый поток |
| GET | `/api/conversations/:id/usage` | Day 8: токены и стоимость по обменам |
| GET | `/api/token-experiments/comparison` | Day 8: сравнение токенов по сценариям диалогов |
| POST | `/api/token-experiments/overflow` | Day 8: реальный тест переполнения контекста |
| POST | `/api/conversations/:id/compressed-messages` | Day 9: чат со сжатием истории |
| GET | `/api/conversations/:id/compression` | Day 9: чекпоинты и экономия |
| POST | `/api/compression-experiments` | Day 9: слепой бенчмарк сжатия |
| GET | `/api/compression-experiments/latest` | последний прогон бенчмарка |
| GET, POST | `/api/context-strategies/sessions` | Day 10: сессии стратегий контекста |
| GET | `/api/context-strategies/sessions/:id` | сессия с ветками |
| POST | `/api/context-strategies/sessions/:id/messages` | сообщение в стратегии |
| POST | `/api/context-strategies/sessions/:id/checkpoint` | чекпоинт для ветвления |
| POST | `/api/context-strategies/sessions/:id/branches/:branchId/activate` | переключение ветки |
| POST | `/api/context-strategies/benchmark` | сравнение стратегий |
| GET | `/api/context-strategies/benchmark/latest` | последний отчёт |

## Память, профили, задачи и инварианты (Day 11–15)

| Метод | Путь | Назначение |
| --- | --- | --- |
| POST | `/api/conversations/:id/memory-messages` | Day 11: чат с тремя слоями памяти и `layers` |
| GET | `/api/conversations/:id/memory` | состояние слоёв диалога |
| POST | `/api/conversations/:id/memory/slots` | запись рабочей памяти |
| DELETE | `/api/conversations/:id/memory/slots/:slotId` | удаление слота |
| POST | `/api/conversations/:id/memory/task` | создание или закрытие (`action: "close"`) задачи рабочей памяти |
| GET, POST | `/api/memory/long-term` | долговременная память профиля |
| DELETE | `/api/memory/long-term/:id` | удаление записи |
| GET, POST | `/api/profiles` | Day 12: профили |
| PATCH, DELETE | `/api/profiles/:id` | изменение и удаление профиля |
| POST | `/api/profiles/:id/activate` | активный профиль |
| POST | `/api/profiles/:id/constraints` | ограничение профиля |
| DELETE | `/api/profiles/:id/constraints/:constraintId` | удаление ограничения |
| POST | `/api/conversations/:id/personalized-messages` | чат с профилем |
| GET, POST | `/api/tasks` | Day 13: задачи автомата |
| POST, DELETE | `/api/tasks/proposal` | предложение задачи из чата |
| POST | `/api/tasks/:id/transition` | переход этапа с проверкой предусловий |
| POST | `/api/tasks/:id/approve-plan` | Day 15: утверждение плана |
| POST | `/api/tasks/:id/pause`, `/api/tasks/:id/resume` | пауза и продолжение |
| POST | `/api/tasks/:id/steps` | новый шаг |
| PATCH, DELETE | `/api/tasks/:id/steps/:stepId` | изменение и удаление шага |
| POST | `/api/conversations/:id/task-messages` | чат с состоянием задачи |
| GET, POST | `/api/invariants` | Day 14: инварианты проекта |
| PATCH | `/api/invariants/:id` | изменение инварианта |
| POST | `/api/invariants/:id/retire`, `/api/invariants/:id/restore` | вывод и возврат |
| POST | `/api/invariants/proposals/:id/accept` | принять предложение |
| DELETE | `/api/invariants/proposals/:id` | отклонить предложение |
| POST | `/api/conversations/:id/invariant-messages` | чат с проверкой инвариантов |

## MCP (Day 16–20)

| Метод | Путь | Назначение |
| --- | --- | --- |
| GET, POST | `/api/mcp-servers` | Day 16: сохранённые MCP-серверы `{ name, url }` |
| DELETE | `/api/mcp-servers/:id` | удаление конфигурации |
| POST | `/api/mcp-servers/:id/discover` | живое получение списка инструментов |
| POST | `/api/conversations/:id/mcp-messages` | Day 17: чат с GitHub-инструментом, NDJSON |
| POST | `/api/conversations/:id/scheduled-messages` | Day 18: чат с планировщиком, NDJSON |
| GET | `/api/schedules` | задания мониторинга профиля |
| GET | `/api/schedules/:id/summary?periodHours=24` | сводка за период |
| POST | `/api/schedules/:id/stop` | остановка задания |
| POST | `/api/conversations/:id/pipeline-messages` | Day 19: поиск → обзор → файл, NDJSON |
| GET | `/api/pipeline/reports` | сохранённые Markdown-отчёты |
| GET | `/api/pipeline/reports/:id` | скачивание отчёта `.md` |
| POST | `/api/conversations/:id/orchestrated-messages` | Day 20: оркестрация MCP-серверов, NDJSON |

Изменяющие MCP-маршруты и `/api/dev-assistant/help` проверяют `Origin` и
`Sec-Fetch-Site` (`validateMcpMutation` в `src/lib/mcp-api.ts`). Тело должно
иметь тип `application/json`.

## Документы и RAG (Day 21–25)

| Метод | Путь | Назначение |
| --- | --- | --- |
| GET | `/api/documents/chunks?strategy=fixed\|structural&offset=0` | Day 21: страницы чанков индекса |
| POST | `/api/rag` | Day 22: `{ question, mode: plain\|rag\|compare }` |
| POST | `/api/rag/benchmark` | Day 22: сравнение на контрольных вопросах |
| POST | `/api/rag/refinement` | Day 23: rewrite и reranking |
| POST | `/api/rag/refinement/benchmark` | Day 23: сравнение трёх режимов |
| POST | `/api/rag/grounded` | Day 24: ответ с источниками и цитатами |
| POST | `/api/rag/grounded/benchmark` | Day 24: проверка цитат |
| GET | `/api/conversations/:id/rag-state` | Day 25: история, память задачи и источники |
| POST | `/api/conversations/:id/rag-messages` | Day 25: `{ content, settings }`, ответ после транзакции |

## Ассистент разработчика (Day 31)

| Метод | Путь | Назначение |
| --- | --- | --- |
| POST | `/api/dev-assistant/help` | команда `{ "command": "/help <вопрос>" }`, NDJSON |
| GET | `/api/dev-assistant/branch` | текущая ветка через MCP-инструмент `git_branch` |

`command` — единственное поле тела, не больше 16 КБ. Команда без вопроса
(`/help`) возвращает справку и текущую ветку без вызова LLM. Любой другой
текст отклоняется с 400. Подробности — в [dev-assistant.md](dev-assistant.md).

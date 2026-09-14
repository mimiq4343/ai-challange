# Day 10: стратегии управления контекстом без summary

## Цель

Добавить страницу `/day-10` с одним агентом и переключателем трёх стратегий:
Sliding Window, Sticky Facts и Branching. Каждая стратегия работает поверх
собственного persistent-состояния в SQLite и не меняет поведение Day 7–9.

## Ограничения

- Summary и таблицы Day 9 не используются.
- LLM credentials, сообщения, facts и ветки остаются server-side.
- Модель по умолчанию — текущая `OPENAI_MODEL` (`deepseek-v4-flash`).
- Sliding/Facts используют окно из 6 сообщений.
- Day 7–9, `/api/chat` и их SQLite-контракты сохраняются.
- Новые source-файлы меньше 800 строк.
- Benchmark делает только необходимые LLM-вызовы, без retry и без judge.

## Архитектура

Новый `SqliteContextStrategyStore` владеет таблицами Day 10 в существующем
`data/chat.sqlite`. Это не раздувает `conversation-store.ts`, который уже близок
к лимиту 800 строк.

`ContextStrategyAgent` выбирает подготовку контекста по strategy:

1. `sliding`: последние 6 сообщений текущей session.
2. `facts`: persisted facts system block + последние 6 сообщений.
3. `branching`: immutable checkpoint prefix + сообщения активной ветки.

Фактический LLM-вызов выполняет существующий `ChatAgent.respond()`: он уже
поддерживает ordered system messages, output limit, streaming и provider usage.

## SQLite

### `context_sessions`

- `id TEXT PRIMARY KEY`
- `strategy TEXT CHECK strategy IN ('sliding', 'facts', 'branching')`
- `title TEXT`
- `facts_json TEXT NULL`
- `active_branch_id TEXT NULL`
- `created_at`, `updated_at`

### `context_messages`

- monotonic `id INTEGER PRIMARY KEY`
- `session_id` с cascade delete
- `branch_id TEXT NULL`
- `role TEXT CHECK role IN ('user', 'assistant')`
- `content TEXT`
- provider `prompt_tokens`, `completion_tokens`, `cost_micros_usd`
- timestamp

Для Sliding после успешного exchange транзакция удаляет всё, кроме последних
6 сообщений session. Для Facts сохраняется полная история в SQLite, но в prompt
попадают только facts + последние 6 сообщений.

### `context_checkpoints`

- `id TEXT PRIMARY KEY`
- `session_id`
- `message_id` — последний общий message
- timestamp

### `context_branches`

- `id TEXT PRIMARY KEY`
- `session_id`
- `checkpoint_id`
- `name`
- timestamp

Checkpoint фиксирует общий prefix. Две ветки ссылаются на один checkpoint.
Branch prompt содержит общий prefix до checkpoint включительно и только messages
выбранной ветки. Messages другой ветки не попадают в prompt или UI активной ветки.

### `context_benchmark_runs`

Хранит outputs и агрегированные метрики трёх стратегий: provider tokens/cost,
число восстановленных обязательных деталей, quality/stability scores, UX note и
timestamp. Полные benchmark prompts не сохраняются.

## Sticky Facts

Facts имеют строгую форму:

```json
{
  "goal": "string",
  "constraints": ["string"],
  "preferences": ["string"],
  "decisions": ["string"],
  "agreements": ["string"]
}
```

Перед основным ответом модель получает предыдущие facts и новое user message.
Она возвращает только JSON указанной формы. Parser запрещает Markdown, лишние
ключи, неправильные типы и чрезмерные массивы. Пустые значения допустимы.

Если extractor или JSON validation падает, основной запрос не выполняется,
предыдущее persisted-состояние не меняется. После успешного main stream exchange,
provider usage и новые facts сохраняются одной транзакцией.

Facts system block сериализуется отдельно от chat system prompt. Сообщения facts
не маскируются под user/assistant history.

## Branching flow

1. Пользователь выбирает Branching и ведёт общий диалог.
2. Кнопка checkpoint фиксирует последний завершённый exchange.
3. Сервер атомарно создаёт checkpoint и две ветки `Ветка A` / `Ветка B`.
4. Переключатель ветки меняет active branch в session.
5. Новые exchanges получают `branch_id` активной ветки.
6. UI показывает общий prefix и messages выбранной ветки.

Повторное создание checkpoint для уже разветвлённой session не нужно для Day 10.
До checkpoint обе ветки отсутствуют; после него ровно две.

## HTTP API

- `GET /api/context-strategies/sessions`
- `POST /api/context-strategies/sessions` — `{ strategy }`
- `GET /api/context-strategies/sessions/:id`
- `POST /api/context-strategies/sessions/:id/messages`
- `POST /api/context-strategies/sessions/:id/checkpoint`
- `POST /api/context-strategies/sessions/:id/branches/:branchId/activate`
- `GET /api/context-strategies/benchmark/latest`
- `POST /api/context-strategies/benchmark`

Ошибки неизвестной strategy/session/branch — 400/404. Provider failure — 502.
Abort не сохраняет partial exchange.

## Интерфейс `/day-10`

Отдельный `Day10Workspace` переиспользует Flash Chat typography, цвета и формы,
но не пытается встроить branching в плоский `ConversationWorkspace`.

Desktop layout:

- верхний segmented strategy switch;
- слева активный диалог;
- справа context inspector и comparison panel;
- Facts показывает текущие key-value поля;
- Branching показывает checkpoint и две branch tabs;
- Sliding показывает `6 / N` retained messages.

На узкой ширине rail скрывается; чат, strategy switch и branch tabs остаются
работоспособны без horizontal overflow. Отдельная mobile analytics UI не входит
в scope.

## Единый benchmark

Фиксированный сценарий ТЗ содержит 12 чередующихся сообщений и обязательные
детали: цель, бюджет, срок, платформа, аудитория, ограничение, решение и
предпочтение. Один финальный вопрос просит вернуть итоговое ТЗ.

- Sliding получает только последние 6 сообщений.
- Facts последовательно обновляет facts на каждом user message, затем получает
  facts + последние 6 сообщений.
- Branching получает общий checkpoint prefix и продолжение выбранной ветки;
  sibling branch содержит конфликтующую деталь и проверяет изоляцию.

Ответ каждой стратегии проверяется детерминированно по обязательным значениям.
Показываются:

- качество: доля обязательных значений в финальном ответе;
- стабильность: потерянные/сохранённые ранние детали;
- токены: provider prompt + completion, facts overhead отдельно;
- удобство: краткая фиксированная характеристика действий и контроля.

Judge не нужен: проверяем известные значения, а не субъективный стиль. Benchmark
не retry-ит LLM-вызовы и сохраняется только целиком успешный run.

## Минимальная проверка

Постоянные тесты только для контрактов с высоким риском:

- Sliding физически оставляет только последние 6 сообщений.
- Facts parser и prompt сохраняют ранние детали после выпадения из window.
- Ветки разделяют checkpoint и не видят messages sibling branch.

Дополнительно: TypeScript, targeted ESLint, один реальный benchmark и browser
smoke `/day-10` на desktop/390 px. Перед интеграцией — production build и
`git diff --check`.

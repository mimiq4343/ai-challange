# Day 9: сжатие истории диалога

## Цель

Добавить к Flash Agent управляемое сжатие истории. Day 9 должен сохранять
полную историю в SQLite, передавать модели только накопительный summary и
последние 10 исходных сообщений, измерять экономию токенов и сравнивать качество
full-history и compressed-history ответов на одном фиксированном сценарии.

Страница `/day-9` строится на интерфейсе `/day-8`, но не содержит блок
«Масштаб контекста», карточки короткого/длинного/overflow сценариев и кнопку
overflow-теста. `/day-7` и `/day-8` сохраняют прежнее поведение.

## Утверждённые решения

- Raw tail содержит последние 10 отдельных сообщений, а не 10 обменов.
- Старые сообщения сворачиваются блоками ровно по 10 сообщений.
- Summary генерирует текущая модель `deepseek-v4-flash` отдельным вызовом.
- Summary ограничен 512 output tokens.
- Каждый новый summary строится из предыдущего summary и следующего блока из
  10 исходных сообщений.
- Summary хранится отдельно от полной истории как неизменяемый checkpoint.
- Ошибка summary останавливает основной запрос. Full-history fallback нет.
- Качество full и compressed ответов оценивает та же модель как слепой LLM-судья.
- Сравнение использует фиксированный изолированный benchmark из 20 сообщений.
- Benchmark выполняет четыре последовательных LLM-вызова без retry.
- Provider usage является источником истины. Локальный tokenizer используется
  для preflight и full/compressed разбивки.
- Поведенческие параметры находятся в version-controlled коде, не в env vars.

## Существующее поведение и совместимость

Day 7 и Day 8 загружают из `messages` всю историю выбранного диалога и передают
её `PersistentChatAgent`. Этот путь не устарел: он нужен предыдущим страницам и
служит full-history контрольным режимом. Он остаётся без изменений.

Day 9 использует те же `conversations`, `messages` и `exchange_usage`. Поэтому
один диалог можно открыть на старых страницах с полной историей или на Day 9 со
сжатием. Полные сообщения не удаляются и не переписываются. Таблицы Day 9
добавляются additive-миграцией при открытии SQLite.

Если Day 9 впервые открывает длинный существующий диалог, перед основным ответом
он последовательно создаёт все отсутствующие checkpoints по 10 сообщений, пока
в raw tail не останется не более 10 сообщений. Каждый успешно сохранённый
checkpoint остаётся доступным, даже если следующий summary-вызов завершился
ошибкой. Основной ответ запускается только после полного обновления summary.

## Термины и константы

```text
RAW_TAIL_MESSAGES = 10
SUMMARY_BATCH_MESSAGES = 10
SUMMARY_MAX_OUTPUT_TOKENS = 512
```

- `full history` — все сохранённые сообщения до нового user request.
- `summary cursor` — ID последнего сообщения, включённого в checkpoint.
- `pending messages` — сообщения после cursor.
- `raw tail` — последние 10 pending messages.
- `compressible batch` — первые 10 pending messages перед raw tail.
- `effective history` — отдельный system summary и raw tail.
- `gross saved tokens` — разница локальных full и effective prompt tokens.
- `summary overhead` — provider prompt + completion tokens summary-вызова.
- `net saved tokens` — gross savings минус summary overhead для конкретного
  сравнения. Judge usage в operational savings не входит.

## Алгоритм checkpoint

Перед каждым compressed request агент выполняет следующий алгоритм:

1. Проверяет существование conversation.
2. Загружает последний summary checkpoint и сообщения после его cursor.
3. Отделяет последние 10 pending messages как raw tail.
4. Если перед raw tail меньше 10 сообщений, завершает checkpoint phase.
5. Берёт первые 10 compressible сообщений.
6. Проверяет локальным tokenizer, что summary prompt и резерв 512 tokens
   помещаются в context window.
7. Вызывает текущую модель с отдельным summarization system prompt.
8. Полностью читает stream, проверяет непустой ответ и provider usage.
9. Сохраняет новый immutable checkpoint с cursor последнего сообщения блока.
10. Повторяет шаги 2–9, пока перед raw tail остаётся полный блок из 10.

При нормальной работе один summary-вызов происходит после каждых 10 новых
сообщений. Несколько вызовов за один request возможны только при первом переходе
длинного старого диалога на Day 9 или после ранее прерванного checkpoint phase.
Автоматического retry нет.

Summary prompt требует сохранить факты, решения, ограничения, предпочтения,
незавершённые задачи и причинно-следственные связи. Он запрещает придумывать
данные и просит удалить приветствия, повторы и промежуточную болтовню. Input
содержит предыдущий summary, если он существует, и ровно 10 новых сообщений с
явными role labels. Новый summary описывает всю историю до нового cursor, а не
только последний блок.

## Контракт ChatAgent

`ChatAgent.respond()` получает необязательные request options:

```ts
type ChatRequestOptions = {
  systemMessages?: readonly string[];
  maxOutputTokens?: number;
};
```

По умолчанию сохраняется существующий контракт Day 6–8:

```ts
systemMessages = [CHAT_SYSTEM_PROMPT]
maxOutputTokens = modelProfile.responseReserveTokens
```

Compressed main request передаёт два system messages:

1. `CHAT_SYSTEM_PROMPT`;
2. отдельный блок «Summary предыдущей части диалога».

Summarizer передаёт собственный system prompt и `maxOutputTokens = 512`.
Benchmark judge передаёт собственный system prompt. Все режимы используют один
существующий streaming transport и один parser provider usage. Server-side
потребители summary и judge полностью читают stream, не отправляя его браузеру.

`countChatPrompt()` получает те же `systemMessages`, чтобы preflight совпадал с
фактической структурой provider request. Вызовы Day 8 без options продолжают
использовать прежний system prompt и reserve 4096.

## CompressedPersistentChatAgent

Новый agent layer отвечает только за compressed flow и не меняет
`PersistentChatAgent`:

1. Обновляет checkpoints по описанному алгоритму.
2. Загружает полный history, последний summary и raw tail.
3. Считает два local preflight:
   - full prompt со всей историей;
   - compressed prompt с summary и raw tail.
4. Проверяет context limit compressed prompt.
5. Вызывает `ChatAgent` с summary и raw tail.
6. Передаёт stream браузеру без изменения plain-text протокола.
7. После штатного завершения stream атомарно сохраняет:
   - user message;
   - assistant message;
   - обычный `exchange_usage` с фактическим compressed provider usage;
   - `exchange_compression` с full/compressed разбивкой.

Пустой, оборванный или ошибочный stream ничего из пункта 7 не сохраняет.
Успешно созданный до него summary checkpoint сохраняется: он относится к уже
существующей истории и не зависит от нового ответа.

## SQLite

### conversation_summaries

Immutable checkpoints:

```text
id                              INTEGER PRIMARY KEY
conversation_id                 TEXT NOT NULL, FK conversations ON DELETE CASCADE
summarized_through_message_id   INTEGER NOT NULL, FK messages ON DELETE CASCADE
summarized_message_count        INTEGER NOT NULL CHECK > 0 AND % 10 = 0
content                         TEXT NOT NULL
model                           TEXT NOT NULL
provider_prompt_tokens          INTEGER
provider_completion_tokens      INTEGER
cost_micros_usd                 INTEGER NOT NULL CHECK >= 0
created_at                      TEXT NOT NULL
UNIQUE(conversation_id, summarized_through_message_id)
```

Последний checkpoint выбирается по `summarized_message_count DESC, id DESC`.
Cursor обязан принадлежать тому же conversation; store проверяет это перед
insert. Пустой summary не сохраняется.

### exchange_compression

Одна строка на compressed exchange:

```text
assistant_message_id            INTEGER PRIMARY KEY, FK messages ON DELETE CASCADE
conversation_id                 TEXT NOT NULL, FK conversations ON DELETE CASCADE
summary_id                      INTEGER, FK conversation_summaries ON DELETE SET NULL
raw_tail_message_count          INTEGER NOT NULL CHECK BETWEEN 0 AND 10
full_prompt_tokens              INTEGER NOT NULL CHECK >= 0
compressed_prompt_tokens        INTEGER NOT NULL CHECK >= 0
summary_tokens                  INTEGER NOT NULL CHECK >= 0
raw_tail_tokens                 INTEGER NOT NULL CHECK >= 0
gross_saved_tokens              INTEGER NOT NULL
created_at                      TEXT NOT NULL
```

`gross_saved_tokens` может быть отрицательным, если summary сжимает конкретный
блок неудачно; UI не скрывает этот факт. Для истории меньше 20 сообщений summary
отсутствует, агент передаёт полную историю, а savings равен нулю.

### compression_runs

Последний успешный benchmark хранит:

- summary, full answer и compressed answer;
- случайное A/B отображение, недоступное judge;
- JSON-оценки factual accuracy, completeness и instruction following;
- общий балл каждой версии, winner или tie, rationale;
- provider prompt/completion tokens и cost для summary, full, compressed и judge;
- gross savings, summary overhead и net savings;
- модель и timestamp.

Большая фиксированная benchmark history не сохраняется: она определена в коде.
Ответы и summary ограничены и безопасно сохраняются для повторного отображения.

## API

### POST /api/conversations/:id/compressed-messages

Request совпадает с Day 8:

```json
{ "content": "Новое сообщение" }
```

Response остаётся `text/plain` stream. Помимо Day 8 token headers endpoint
возвращает:

```text
X-Compression-Full-History
X-Compression-Summary
X-Compression-Raw-Tail
X-Compression-Effective-History
X-Compression-Saved
X-Compression-Raw-Tail-Messages
X-Compression-Summarized-Messages
```

Значения headers являются local estimates до provider response. После clean
stream UI запрашивает persisted metrics с фактическим provider usage.

### GET /api/conversations/:id/compression

Возвращает:

- последний summary и его cursor;
- число summarized и raw-tail сообщений;
- summary provider usage и cost;
- timeline compressed exchanges;
- cumulative full/compressed prompt estimates;
- cumulative gross savings;
- фактический compressed provider usage и стоимость.

Endpoint возвращает 404 для неизвестного conversation и `Cache-Control:
no-store`.

### POST /api/compression-experiments

Требует `{ "confirmed": true }`. Клиент не может передать модель, prompt,
history или judge rubric. Endpoint выполняет четыре последовательных вызова без
retry и возвращает сохранённый benchmark run.

### GET /api/compression-experiments/latest

Возвращает последний успешный run или `null`. Результат не кешируется.

## Benchmark качества

Фиксированный benchmark содержит 20 коротких сообщений, то есть 10 обменов.
Контрольные факты распределены между первыми 10 сообщениями и raw tail. Финальный
вопрос требует восстановить факты из обеих частей и соблюсти явный формат
ответа.

Последовательность ровно из четырёх вызовов:

1. Summary первых 10 сообщений.
2. Full answer: все 20 сообщений и контрольный вопрос.
3. Compressed answer: summary, последние 10 сообщений и тот же вопрос.
4. Blind judge: reference facts, rubric и ответы под случайными метками A/B.

Judge не получает слова `full` и `compressed`, token usage, стоимость или
порядок генерации. Сервер случайно назначает A/B и после JSON-валидации
восстанавливает реальные labels.

Judge JSON:

```json
{
  "a": {
    "factualAccuracy": 0,
    "completeness": 0,
    "instructionFollowing": 0,
    "overall": 0
  },
  "b": {
    "factualAccuracy": 0,
    "completeness": 0,
    "instructionFollowing": 0,
    "overall": 0
  },
  "winner": "a",
  "rationale": "Краткое объяснение"
}
```

Каждый score — целое число 0–10. `winner` принимает `a`, `b` или `tie`.
Некорректный JSON, score вне диапазона, неизвестный winner или пустой rationale
завершает run явной upstream error. Выдуманный fallback result запрещён.

Token comparison показывает:

- фактический full prompt usage;
- фактический compressed prompt usage;
- gross difference и процент;
- summary prompt + completion overhead;
- net savings для benchmark;
- стоимость summary, обоих ответов и judge отдельно.

Judge overhead показывается, но не вычитается из operational net savings:
LLM-судья существует только в демонстрационном experiment.

## Интерфейс /day-9

Day 9 переиспользует `ConversationWorkspace`, sidebar, streaming chat и token
badges. Workspace получает отдельный compressed message endpoint и callbacks для
compression headers. Day 7 и Day 8 используют defaults и не меняют поведение.

Desktop сохраняет три области Day 8: sidebar, chat и analytics rail. Mobile
сохраняет analytics bottom sheet с focus trap, Escape и возвратом focus.
Интерактивные области не меньше 44×44 px; horizontal overflow запрещён.

Day 9 analytics rail показывает:

- full history tokens;
- effective history tokens;
- saved tokens и процент;
- число summarized messages;
- raw tail count из 10;
- summary overhead и накопительную стоимость;
- сворачиваемый текст последнего summary;
- для каждого compressed exchange две подписанные полосы full/compressed.

Ниже находится benchmark panel с явным подтверждением четырёх реальных вызовов.
После запуска он показывает full и compressed ответы рядом, blind judge scores,
winner, rationale, token savings и cost breakdown.

На `/day-9` отсутствуют компонент `TokenComparison`, заголовок «Масштаб
контекста», карточки «Короткий», «Длинный», «Переполнение» и overflow-кнопка.
`/day-8` продолжает рендерить их без изменений.

## Ошибки

- Missing model profile, tokenizer или LLM configuration завершается явной
  configuration error.
- Summary failure останавливает основной request и не запускает fallback.
- Несколько успешно созданных checkpoints не откатываются при ошибке следующего
  summary batch.
- Context overflow compressed prompt возвращает существующий локальный 422 до
  основного provider call.
- Ошибка основного stream не сохраняет exchange и compression metrics.
- Malformed judge output завершает benchmark без сохранения ложного результата.
- Все неожиданные ошибки логируются один раз на owning HTTP boundary без content,
  summary, API keys и полного provider body.
- Автоматических retry нет ни в live compression, ни в benchmark.

## Проверка

Постоянные contract tests покрывают риски:

- границы 9, 10, 19, 20 и 30 сообщений;
- выбор следующего блока и последних 10 raw messages;
- incremental summary из предыдущего checkpoint и нового блока;
- восстановление checkpoint после повторного открытия SQLite;
- cascade delete summary и compression metrics;
- запрет main call после summary error;
- точную структуру summary + raw tail provider request;
- атомарное сохранение exchange usage и compression metrics;
- отсутствие exchange после stream failure;
- ровно четыре benchmark calls и отсутствие retry;
- blind A/B mapping и строгую judge JSON validation;
- gross, overhead и net token calculations;
- неизменность Day 7/8 default ChatAgent contract.

Практическая проверка:

1. Создать или открыть длинный диалог на `/day-9`.
2. Получить реальный summary и compressed response через `deepseek-v4-flash`.
3. Сверить summary cursor, raw tail и saved tokens с SQLite.
4. Перезапустить Next.js и подтвердить восстановление summary.
5. Выполнить один реальный benchmark из четырёх вызовов.
6. Сверить UI с последним `compression_runs`.
7. Проверить desktop 1440×900 и mobile 390×844, focus и отсутствие overflow.
8. Открыть `/day-7` и `/day-8`; Day 8 должен сохранить прежний comparison block.
9. Запустить targeted tests, ESLint, TypeScript и production build.

## Вне scope

- Удаление или физическое сокращение полной истории.
- Vector database, embeddings и retrieval-augmented generation.
- Несколько уровней summary или tree summarization.
- Пользовательская настройка N, batch size и summary token limit.
- Отдельная summarization-модель.
- Фоновая очередь, cron и автоматические retry.
- Изменение Day 7/8 API или визуального контракта.

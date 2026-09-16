# Day 8: подсчёт токенов и переполнение контекста

## Цель

Добавить к существующему многодиалоговому агенту измерение токенов текущего
запроса, накопленной истории и ответа модели. Страница `/day-8` должна показать,
как с каждым обменом растут prompt tokens и стоимость, сравнить короткий и
длинный диалоги и выполнить реальный внешний запрос, превышающий context window
модели.

Day 6 и Day 7 остаются рабочими. Day 8 разрабатывается в отдельной ветке
`day-8`, созданной от актуального `main`. Слияние и push выполняются только по
отдельной команде пользователя.

## Утверждённые решения

- Подсчёт гибридный: локальный model-specific tokenizer до запроса и
  фактический provider usage после ответа.
- Live-чат использует текущий `deepseek-v4-flash` через официальный DeepSeek
  API.
- Метрики обменов сохраняются в текущей SQLite рядом с историей Day 7.
- `ChatAgent` расширяется; отдельный дублирующий агент и второй LLM-запрос не
  создаются.
- Для локального подсчёта используются официальные tokenizer assets DeepSeek V4.
- Реальный overflow-тест использует бесплатную embedding-модель OpenRouter
  `nvidia/nemotron-3-embed-1b:free` с окном 32,768 токенов.
- Overflow-тест действительно обращается к OpenRouter `/api/v1/embeddings`; это
  не mock и не локальная симуляция.
- UI реализуется по `ui-ux-pro-max`, но сохраняет текущую визуальную систему
  Flash Chat.
- TDD не используется. Полезные автоматические проверки добавляются после
  реализации контрактов.

## Модели и тарифы

### Live-чат

Текущий идентификатор `deepseek-v4-flash` является legacy alias. Официальный
DeepSeek API обслуживает его моделью DeepSeek-V4.1-Flash по тарифу Flash.
Профиль хранится в version-controlled коде и содержит:

- context window: 1,000,000 токенов;
- maximum output: 393,216 токенов;
- cache hit input: $0.003/M off-peak, $0.006/M peak;
- cache miss input: $0.15/M off-peak, $0.30/M peak;
- output: $0.60/M off-peak, $1.20/M peak;
- peak: понедельник–пятница, 01:00–04:00 и 06:00–10:00 UTC;
- дату и URL источника тарифа.

Неизвестный live model ID вызывает явную configuration error. Выдуманный
context window или тариф не подставляется.

### Overflow-модель

Профиль OpenRouter содержит:

- model: `nvidia/nemotron-3-embed-1b:free`;
- endpoint: `https://openrouter.ai/api/v1/embeddings`;
- context window: 32,768 токенов;
- цена: $0;
- официальный tokenizer NVIDIA Nemotron 3 Embed 1B;
- источник model metadata.

`OPENROUTER_API_KEY` хранится только в `.env.local`. `.env.example` содержит
пустое имя переменной. Ключ не попадает в браузер, SQLite, логи, ошибки или Git.

## Tokenizer

Server-only модуль загружает локальные `tokenizer.json` и
`tokenizer_config.json` через `@huggingface/transformers`.

- Remote model loading отключён.
- Assets версионированы вместе с источником и checksum.
- Tokenizer загружается лениво и переиспользуется одним promise на процесс.
- Ошибка загрузки не скрывается приблизительным fallback.
- Next.js не отправляет tokenizer assets в client bundle.

Для chat prompt применяется chat template модели. Разбивка считается через
разность префиксов:

1. `systemTokens` — system prompt с framing;
2. `historyTokens` — `system + history` минус `system`;
3. `requestTokens` — полный prompt минус `system + history`;
4. `promptTokens` — полный prompt;
5. `reservedOutputTokens` — явно заданный резерв ответа;
6. `contextTokens` — prompt плюс резерв.

Response tokens локально считаются без chat framing. После stream фактические
`prompt_tokens` и `completion_tokens` провайдера являются источником истины для
общей стоимости. Локальная разбивка request/history остаётся оценочной и явно
маркируется в UI.

## Контракт ChatAgent

`ChatAgent.respond()` возвращает объект ответа вместо голого stream:

```ts
type ChatAgentResponse = {
  stream: ReadableStream<Uint8Array>;
  usage: Promise<ProviderTokenUsage | null>;
};
```

SSE parser продолжает передавать только текстовые delta в `stream`, но также
читает usage последнего события. Promise завершается только вместе со stream:

- provider usage найден — возвращается нормализованная структура;
- provider usage отсутствует — возвращается `null`;
- stream оборван или упал — usage не используется для persistence.

Все существующие callers мигрируют на новый контракт. Day 6 возвращает
`response.stream` и не показывает аналитику. Day 7 сохраняет прежнее наблюдаемое
поведение.

## Preflight и обработка лимита

Перед live API-вызовом token-aware слой считает полный prompt и резерв ответа.
При `contextTokens > contextWindow` запрос к провайдеру не выполняется.
Возвращается HTTP `422`:

```ts
type ContextLimitPayload = {
  error: "context_limit";
  limit: number;
  system: number;
  history: number;
  request: number;
  reservedOutput: number;
  total: number;
  overflow: number;
};
```

Если provider отклоняет запрос собственным context error несмотря на локальный
preflight, ошибка остаётся upstream error. UI не смешивает её с локальным `422`.
Retry отсутствует.

## Persistence

К существующей SQLite добавляется additive STRICT-таблица `exchange_usage`.
Одна строка соответствует полностью сохранённому обмену и ссылается на
conversation и assistant message. Она содержит:

- model ID и context limit;
- system/history/request/prompt/response tokens;
- provider prompt/completion/cache-hit/cache-miss tokens;
- `provider` или `estimated` source;
- стоимость в целочисленных millionths of USD;
- peak/off-peak tariff band;
- timestamp.

`user + assistant + usage` записываются одной транзакцией только после полного
stream. Оборванный stream не создаёт ни сообщения, ни usage. Удаление диалога
каскадно удаляет метрики.

Старые диалоги Day 7 не мигрируются выдуманными фактическими числами. Для них
Day 8 рассчитывает локальные estimates при чтении и показывает соответствующий
label.

Результаты реального overflow-теста сохраняются отдельно в STRICT-таблице
`overflow_runs`:

- model и configured limit;
- локально измеренный input;
- provider-reported tokens, если они были возвращены;
- outcome: `rejected`, `truncated`, `accepted` или `network_error`;
- HTTP status и безопасный фрагмент provider error;
- duration;
- cost, равный $0 для выбранной free-модели;
- timestamp.

Сверхдлинный input и embedding vector не сохраняются.

## Реальный overflow-тест

Кнопка `Запустить реальный overflow-тест` вызывает отдельный server-only
endpoint. До вызова показывается подтверждение с моделью, лимитом, ожидаемым
объёмом, ценой $0 и отсутствием retry.

Endpoint:

1. Загружает официальный Nemotron tokenizer.
2. Детерминированно формирует текст.
3. Увеличивает его до локально подтверждённого диапазона
   `32,768 + 512` токенов.
4. Выполняет один `POST /embeddings` с текущим `OPENROUTER_API_KEY`.
5. Не использует normal chat preflight: bypass существует только внутри этого
   experiment endpoint.
6. Отбрасывает embedding vector и возвращает компактные метрики.
7. Классифицирует наблюдаемый результат:
   - `rejected` — provider вернул context-length error;
   - `truncated` — запрос успешен, но provider usage ниже локального input;
   - `accepted` — provider сообщил обработку сверх configured limit;
   - `network_error` — запрос не достиг проверяемого результата.

UI показывает наблюдение, а не обещает заранее конкретную ошибку. Если provider
молча обрезает input или реально принимает его, это и есть результат
эксперимента.

Кнопка disabled во время запроса. Повторный запрос не запускается автоматически.

## API

Существующий message endpoint сохраняет plain-text stream. Он не превращается в
custom multiplexed protocol.

Добавляются:

```text
GET  /api/conversations/:id/usage
GET  /api/token-experiments/comparison
POST /api/token-experiments/overflow
```

`GET usage` возвращает сохранённую временную шкалу обменов и cumulative totals.
`GET comparison` считает детерминированные offline fixtures короткого и длинного
диалога и добавляет последний overflow run. `POST overflow` требует явный
`confirmed: true`.

## Интерфейс `/day-8`

Desktop использует fluid layout из sidebar, чата и правой аналитической панели.
На mobile sidebar остаётся drawer, а аналитика открывается отдельной кнопкой как
bottom sheet. Day 7 не получает новых панелей.

Аналитика показывает:

- current request tokens;
- history tokens;
- response tokens;
- context usage и процент лимита;
- стоимость обмена;
- накопительную стоимость;
- source badge `provider` или `estimated`.

Ниже расположен stacked bar по каждому обмену. История, текущий запрос и ответ
имеют стабильные цветовые роли. Реализация использует SVG/CSS без новой
chart-библиотеки.

У сообщений есть компактные token badges. Предварительные числа во время stream
помечены estimate; после persistence панель перечитывает usage из SQLite.

Блок сравнения показывает короткий, длинный и overflow-сценарий рядом:
request/history/response/total/context usage/cost/result. Для overflow доступны
кнопка реального теста, confirmation, loading state и последний сохранённый
результат.

## Ошибки

- Missing model profile, tokenizer asset или required key завершается явной
  configuration error.
- Provider error логируется один раз на API boundary без request body и ключей.
- Provider error body ограничивается безопасным фрагментом перед сохранением.
- Abort сохраняет прежнюю историю и не создаёт usage.
- Ошибка чтения аналитики не уничтожает сообщения; панели имеют отдельное error
  state.
- Overflow endpoint имеет один ограниченный запрос и timeout без retry.

## Проверка

TDD не применяется. После реализации добавляются только проверки контрактов,
где правдоподобная ошибка дала бы неверный результат:

- официальный tokenizer fixture и chat-template framing;
- разбивка system/history/request;
- граница `limit - 1`, `limit`, `limit + 1`;
- DeepSeek cache pricing и peak/off-peak;
- provider usage из последнего SSE event;
- транзакционное сохранение usage и cascade delete;
- отсутствие persistence при оборванном stream;
- классификация rejected/truncated/accepted overflow результата.

Финальная практическая проверка:

1. Короткий реальный диалог.
2. Несколько продолжений до заметного роста history и cumulative cost.
3. Полный рестарт Next.js и восстановление метрик.
4. Реальный OpenRouter overflow-запрос кнопкой.
5. Подтверждение фактического provider outcome и `cost = $0`.
6. Desktop и mobile UI без horizontal overflow, с keyboard focus и размерами
   интерактивных областей не меньше 44×44 px.
7. Проверка `/day-6`, `/day-7`, targeted ESLint, TypeScript, persistence tests и
   production build.

## Источники

- DeepSeek Chat API: https://api-docs.deepseek.com/api/create-chat-completion/
- DeepSeek token usage: https://api-docs.deepseek.com/quick_start/token_usage/
- DeepSeek pricing: https://api-docs.deepseek.com/quick_start/pricing/
- OpenRouter model card:
  https://openrouter.ai/nvidia/nemotron-3-embed-1b:free
- OpenRouter Embeddings API:
  https://openrouter.ai/docs/api/reference/embeddings
- NVIDIA model/tokenizer:
  https://huggingface.co/nvidia/Nemotron-3-Embed-1B-BF16

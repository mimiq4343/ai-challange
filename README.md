# AI Advent Challenge #9

Автор: **Roman Sukhin** (@mimiq43).

Одно Next.js-приложение для заданий **AI Advent Challenge #9**. Каждый день
разрабатывается в отдельной ветке и вливается в `main` после проверки. В `main`
стабильна версия Day 7; ветка `day-8` добавляет измерение токенов, стоимости и
переполнения контекстного окна, а `day-11-kimi` — явную модель памяти агента.

Стек: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4 и встроенный
`node:sqlite`. Требуется Node.js **22.13 или новее**. LLM подключается через
любой OpenAI-совместимый API.

## Структура веток

| Ветка   | Что в ней                                        |
| ------- | ------------------------------------------------ |
| `main`  | Стабильная версия приложения, сейчас Day 7       |
| `day-1` | Day 1 «Лендинг-чат»                              |
| `day-2` | Day 2 «Формат ответа»                            |
| `day-3` | Day 3 «Способы рассуждения»                      |
| `day-4` | Day 4 «Температура»                              |
| `day-5` | Day 5 «Слабая, средняя и сильная модель»         |
| `day-6` | Day 6 «Первый агент»                             |
| `day-7` | Day 7 «Сохранение контекста между запусками»     |
| `day-8` | Day 8 «Токены и переполнение контекста»            |
| `day-11-kimi` | Day 11 «Модель памяти агента»                  |

## Хронология

### Day 1 · Лендинг-чат — страница `/`

Flash Chat: лендинг с полноэкранным чатом для любой OpenAI-совместимой модели.
Стриминг ответов по SSE, Markdown-рендер, остановка генерации и новый диалог.
Ключ и конфиг провайдера остаются на сервере.

### Day 2 · Формат ответа — страница `/day-2`

Один запрос сравнивается бок о бок без ограничений и через тематического агента
«Кино-консьерж» с JSON-схемой, лимитом ответа, stop sequence и системной ролью.

### Day 3 · Способы рассуждения — страница `/day-3`

Одна задача решается четырьмя способами: прямой ответ, пошаговое решение,
мета-промпт и группа экспертов. Ответы автоматически сверяются с эталоном, а
сводная таблица сравнивает точность, время, длину и число запросов к API.

### Day 4 · Температура — страница `/day-4`

Один запрос выполняется по три раза при `temperature` 0, 0.7, 1.2 и 1.7.
Приложение измеряет точность и разнообразие, а отдельный запрос-судья оценивает
креативность и связность.

### Day 5 · Слабая, средняя и сильная модель — страница `/day-5`

Один запрос при одинаковых настройках уходит на три модели разных классов.
Поток NDJSON содержит ответы и метрики: время до первого токена, полное время,
скорость, число токенов и стоимость. Качество проверяется эталоном и слепым
LLM-судьёй.

### Day 6 · Первый агент — страница `/day-6`

`ChatAgent` инкапсулирует системную роль, конфигурацию провайдера, запрос к LLM,
обработку SSE и ошибки. `/api/chat` остаётся тонкой HTTP-границей, а интерфейс
потоково показывает Markdown-ответ.

### Day 7 · Сохранение контекста — страница `/day-7`

Пользователь создаёт несколько независимых диалогов, выбирает их в sidebar и
удаляет вместе с сообщениями. На мобильных sidebar работает как drawer.
Сохранённая история восстанавливается после полного рестарта Next.js и снова
передаётся LLM при продолжении разговора.

```text
Browser → conversation API → PersistentChatAgent → SQLite history
                                      │
                                      └→ ChatAgent → LLM
```

`PersistentChatAgent` перед каждым вызовом загружает сообщения выбранного
диалога из SQLite. Только после штатного завершения stream он одной транзакцией
сохраняет пару `user + assistant`; оборванный ответ не оставляет половину обмена.

### Day 8 · Токены и переполнение контекста — страница `/day-8`

Перед каждым запросом сервер считает системный промпт, историю, новое сообщение
и резерв ответа локальным официальным токенизатором DeepSeek. После завершения
stream фактические `prompt_tokens`, `completion_tokens`, cache split и стоимость
сохраняются в SQLite вместе с обменом. Локальная разбивка помечается как
`estimate`; итоговые значения провайдера остаются источником истины.

Интерфейс показывает рост текущего контекста, накопительные токены и стоимость,
а также сравнивает короткий и длинный сценарии. Отдельный подтверждаемый тест
делает ровно один запрос к OpenRouter Embeddings с input больше лимита 32 768
токенов модели `nvidia/nemotron-3-embed-1b:free`. Retry нет; большой input и
embedding vector не сохраняются и не логируются.

### Day 11 · Модель памяти агента — страница `/day-11`

Три слоя памяти хранятся отдельно и явно наполняются пользователем:

- **Краткосрочная** — сообщения активного диалога (таблица `messages`). История
  уходит в запрос целиком и удаляется вместе с диалогом.
- **Рабочая** — заметки текущей задачи (таблица `working_memory`), привязаны к
  диалогу через `ON DELETE CASCADE`. Попадают в system prompt только этого
  диалога.
- **Долговременная** — профиль, решения и знания (таблица `long_term_memory`).
  Глобальны: попадают в system prompt всех диалогов и переживают рестарт.

Записи добавляются и удаляются только вручную через панель «Слои памяти» — агент
сам ничего не сохраняет. `PersistentChatAgent` перед каждым вызовом собирает
system prompt из базовой роли и обоих слоёв, поэтому панель показывает точный
инъецируемый текст и его стоимость в токенах. Телеметрия Day 8 переехала в
компактную строку под полем ввода; блок «Масштаб контекста» с overflow-тестом на
странице убран (endpoint `/api/token-experiments/overflow` сохранён).

## SQLite и API Day 7–11

История создаётся автоматически в `data/chat.sqlite`. SQLite работает в
WAL-режиме, foreign keys включены. Таблицы `conversations` и `messages` связаны
через `ON DELETE CASCADE`. SQLite, WAL и SHM исключены из git.

```text
GET    /api/conversations
POST   /api/conversations
GET    /api/conversations/:id
DELETE /api/conversations/:id
POST   /api/conversations/:id/messages
```

```text
GET  /api/conversations/:id/usage
GET  /api/token-experiments/comparison
POST /api/token-experiments/overflow
```

```text
GET    /api/memory?conversationId=
POST   /api/memory/long-term
DELETE /api/memory/long-term/:id
POST   /api/memory/working
DELETE /api/memory/working/:id
```

Day 8 добавляет STRICT-таблицы `exchange_usage` и `overflow_runs`. Сообщения и
usage одного завершённого обмена сохраняются одной транзакцией. Старые обмены
Day 7 рассчитываются при чтении как `estimated` без обратной записи в базу.

Day 11 добавляет STRICT-таблицы `long_term_memory` (глобальная, категории
`profile`/`decision`/`knowledge`) и `working_memory` (привязана к диалогу,
каскадное удаление). Записи ограничены 500 символами; лимиты — 50 долговременных
и 20 рабочих на диалог. Обе таблицы наполняются только явными действиями
пользователя через API.

Браузер отправляет только ID диалога и новое сообщение. Прежний контекст
загружает сервер, поэтому клиент не может подменить сохранённую историю.

## Запуск

В `main` доступны все завершённые страницы. Для точного снимка конкретного дня
переключитесь на его ветку перед запуском:

```bash
git checkout day-N
```

```bash
npm install
cp .env.example .env.local
npm run dev
```

Заполните `.env.local`:

```dotenv
OPENAI_BASE_URL=https://api.deepseek.com/v1
OPENAI_API_KEY=sk-...
OPENAI_MODEL=deepseek-v4-flash
```

Для Day 5 также нужны `GROQ_BASE_URL` и `GROQ_API_KEY`. Подойдёт любой провайдер
с OpenAI-совместимым методом `POST /chat/completions`: DeepSeek, OpenAI,
OpenRouter или локальный Ollama. API-ключи остаются на сервере.

Для реального overflow-теста Day 8 добавьте отдельно:

```dotenv
OPENROUTER_API_KEY=sk-or-...
```

Этот ключ используется только серверным endpoint `/api/token-experiments/overflow`.

- Day 1: http://localhost:3000/
- Day 2: http://localhost:3000/day-2
- Day 3: http://localhost:3000/day-3
- Day 4: http://localhost:3000/day-4
- Day 5: http://localhost:3000/day-5
- Day 6: http://localhost:3000/day-6
- Day 7: http://localhost:3000/day-7
- Day 8: http://localhost:3000/day-8
- Day 11: http://localhost:3000/day-11

Если приложение открывается по сетевому адресу машины, этот origin должен быть
разрешён в `allowedDevOrigins` файла `next.config.ts`.

## Проверка Day 11

```bash
npm run test:tokens
npm run test:memory
npm run test:persistence
npm run lint
npx tsc --noEmit
npm run build
```

`test:tokens` проверяет локальный токенизатор, лимит контекста, тарифы, provider
usage, аналитику legacy-обменов и классификацию overflow-ответов. Тесты работают
только с локальными tokenizer assets; загрузка моделей из сети отключена.

`test:memory` проверяет раздельное хранение слоёв, каскад рабочей памяти,
валидацию и лимиты записей, сборку system prompt и снапшот слоёв.

Сценарий влияния памяти на ответы:

1. На `/day-11` сохранить в долговременную память факт («Мой любимый напиток —
   квас»), открыть новый диалог и спросить о нём: агент отвечает из
   долговременного слоя при пустой истории.
2. Добавить рабочую заметку («Кодовое слово задачи: КЕДР-42») и спросить её в
   том же диалоге — агент знает слово. В новом диалоге — уже нет: рабочий слой
   изолирован диалогом.
3. Блок «Что уходит в system prompt» показывает точный инъецируемый текст и его
   вес в токенах; строка телеметрии под полем ввода отражает рост `system`.

Практический сценарий:

1. На `/day-8` отправить короткий запрос и проверить badge `provider`.
2. Создать длинный диалог и убедиться, что `history` вырос при следующем обмене.
3. Полностью остановить и снова запустить `npm run dev`; usage должен
   восстановиться из SQLite.
4. Добавить `OPENROUTER_API_KEY`, подтвердить один overflow-запрос и сверить
   outcome в UI с последней записью `overflow_runs`.
5. Проверить, что `/day-6` и `/day-7` продолжают открываться.

## Структура Day 7–11

```text
src/
  app/
    api/conversations/                  REST API диалогов и usage
    api/memory/                         snapshot и мутации слоёв памяти
    api/token-experiments/              comparison и реальный overflow
    day-7/page.tsx                      серверная загрузка постоянного чата
    day-8/page.tsx                      чат с token analytics
    day-11/page.tsx                     чат с панелью слоёв памяти
  components/
    conversation-sidebar.tsx            список, создание и удаление
    conversation-workspace.tsx          чат, stream и token badges
    day11-workspace.tsx                 чат, телеметрия и панель памяти
    memory-panel.tsx                    три слоя: просмотр и явное сохранение
    token-telemetry-strip.tsx           компактные токены под полем ввода
    day8-workspace.tsx                  синхронизация чата и аналитики
    token-analytics-panel.tsx           рост контекста и стоимость
    token-comparison.tsx                short/long/overflow сравнение
  lib/
    chat-agent.ts                       вызов LLM и provider usage
    conversation-store.ts               SQLite и атомарные транзакции
    memory.ts                           сборка system prompt и snapshot слоёв
    conversation-types.ts               общие контракты
    model-profiles.ts                    лимиты моделей и tokenizer paths
    overflow-experiment.ts              один OpenRouter Embeddings запрос
    persistent-chat-agent.ts            preflight и сохранение обмена
    token-analytics.ts                   timeline и legacy estimates
    token-cost.ts                        тарифы в целых micro-USD
    token-counter.ts                     локальные official tokenizers
tests/
  chat-agent-usage.test.ts
  conversation-store.test.ts
  conversation-usage.test.ts
  overflow-experiment.test.ts
  persistent-chat-agent.test.ts
  token-cost.test.ts
  token-counter.test.ts
  memory.test.ts
```

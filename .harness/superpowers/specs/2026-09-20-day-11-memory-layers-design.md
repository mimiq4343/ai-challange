# Day 11: явная модель памяти агента

## Цель

Разделить память агента на три независимых слоя с раздельным хранением и явным
правилом маршрутизации записи, показать вклад каждого слоя в промпт и дать
возможность отключить любой слой, чтобы наблюдать изменение ответа.

Ветка `day-11` создана от `day-8`. Day 6, Day 7 и Day 8 остаются рабочими:
`/day-6`, `/api/chat`, `/day-7`, `/day-8`, `/api/conversations/*` и
`/api/token-experiments/*` сохраняют наблюдаемое поведение.

## Утверждённые решения

- Три слоя: краткосрочная (STM), рабочая (WM), долговременная (LTM).
- STM — скользящее окно последних сообщений диалога, а не вся история. То, что
  вышло из окна, сохраняется дальше только через WM или LTM.
- WM — одна активная задача на диалог: цель и слоты `fact`, `constraint`,
  `step`, `open_question`.
- LTM — глобальная, поверх всех диалогов: `profile`, `decision`, `knowledge`.
  Удаление диалога не удаляет LTM.
- Запись в память выполняет отдельный LLM-роутер после каждого завершённого
  обмена; журнал записей с причиной виден в интерфейсе; записи можно удалять и
  добавлять вручную.
- Слои включаются и выключаются тумблерами; выключенный слой не попадает в
  промпт и считается нулевым вкладом.
- Телеметрия токенов остаётся, но переезжает под поле ввода в компактном виде.
  Блок «Масштаб контекста» и overflow-тест на странице Day 11 не появляются.
- Все таблицы Day 11 имеют префикс `memory_` и не пересекаются с таблицами
  предыдущих дней.

## Модель памяти

| Слой | Содержимое | Область | Носитель | Жизненный цикл |
| --- | --- | --- | --- | --- |
| STM | последние `MEMORY_WINDOW_MESSAGES = 8` сообщений | диалог | `messages` (Day 7) | вытесняется окном |
| WM | активная задача и её слоты | диалог | `memory_working_tasks`, `memory_working_slots` | до закрытия задачи |
| LTM | профиль, решения, знания | глобально | `memory_long_term` | до удаления записи |

### Правила маршрутизации

Роутер получает последний обмен, текущую задачу и список ключей LTM, и
возвращает строгий JSON:

```json
{
  "task": { "title": "...", "goal": "...", "status": "active" },
  "writes": [
    { "layer": "long_term", "kind": "profile", "key": "favourite_color", "value": "синий", "reason": "..." },
    { "layer": "working", "kind": "constraint", "value": "без сторонних библиотек", "reason": "..." }
  ]
}
```

- `long_term` — устойчивые сведения о пользователе, принятые решения, факты,
  полезные вне текущей задачи, и всё, что пользователь просил запомнить.
- `working` — цель, ограничения, шаги и открытые вопросы текущей задачи.
- Ничего больше не пишется: реплики диалога уже покрыты STM.
- LTM уникальна по паре `(kind, key)`: повтор обновляет значение, а не
  накапливает копии.
- Невалидный ответ роутера не пишет ничего и не откатывает сохранённый обмен.

## Хранилище

Новый модуль `sqlite-database.ts` владеет единственным соединением
`node:sqlite` и его PRAGMA; `SqliteConversationStore` и `SqliteMemoryStore`
получают это соединение. Два writer-соединения к одному WAL-файлу не
создаются.

Таблицы `SqliteMemoryStore` (все STRICT):

- `memory_long_term` — `kind`, `key`, `value`, `origin` (`router` | `user`),
  `reason`, `source_conversation_id`, `created_at`, `updated_at`,
  `UNIQUE (kind, key)`.
- `memory_working_tasks` — `conversation_id` (FK CASCADE), `title`, `goal`,
  `status` (`active` | `closed`), временные метки; активная задача не более
  одной на диалог.
- `memory_working_slots` — `task_id` (FK CASCADE), `kind`, `value`, `origin`,
  `reason`, `created_at`.
- `memory_writes` — журнал: `conversation_id`, `assistant_message_id`, `layer`,
  `kind`, `key`, `value`, `reason`, `origin`, `created_at`.
- `memory_exchange_usage` — вклад слоёв в обмен: `assistant_message_id` UNIQUE,
  `system_tokens`, `ltm_tokens`, `wm_tokens`, `stm_tokens`, `request_tokens`,
  `prompt_tokens`, `layers_enabled`, `router_prompt_tokens`,
  `router_completion_tokens`, `router_cost_micros_usd`, `created_at`.

## Сборка промпта и токены

`memory-composer.ts` собирает запрос в фиксированном порядке:

1. `system` — `CHAT_SYSTEM_PROMPT`;
2. `system` — блок LTM, если слой включён и непуст (бюджет 2 000 токенов);
3. `system` — блок WM, если слой включён и есть активная задача (бюджет 1 000
   токенов);
4. STM — сообщения окна, если слой включён;
5. `user` — текущий запрос.

Бюджеты отсекают хвост, отсортированный по `updated_at DESC`; отсечённые записи
не удаляются из базы и видны в инспекторе как невошедшие. Вклад слоёв в токены
считается префиксными разностями `apply_chat_template` — тем же способом, что и
`countChatPrompt` в Day 8. Проверка `assertContextFits` сохраняется.

## API

- `POST /api/conversations/[id]/memory-messages` — чат Day 11, тело
  `{ content, layers: { shortTerm, working, longTerm } }`, ответ — text stream,
  заголовки Day 8 `X-Token-*` плюс `X-Memory-Ltm`, `X-Memory-Wm`,
  `X-Memory-Stm`, `X-Memory-Stm-Messages`.
- `GET /api/memory/long-term`, `POST /api/memory/long-term`,
  `DELETE /api/memory/long-term/[id]`.
- `GET /api/conversations/[id]/memory` — активная задача, слоты, сводка STM и
  журнал записей.
- `POST /api/conversations/[id]/memory/task` — создать, обновить или закрыть
  задачу; закрытие возвращает кандидатов на перенос в LTM.
- `POST /api/conversations/[id]/memory/slots`,
  `DELETE /api/conversations/[id]/memory/slots/[slotId]`.

## Интерфейс `/day-11`

- `Day11Workspace` строится поверх общего `ConversationWorkspace`, как
  `Day8Workspace`; расширение общего компонента повторяет приём Day 9 и Day 10:
  проп `messageRoute`, событие `onResponseHeaders`, новый проп `inputFooter` и
  `requestBodyExtra` для тумблеров.
- Правый rail на `xl` и bottom sheet на мобильных — инспектор памяти: три
  секции с тумблерами и счётчиками, CRUD по записям LTM и слотам WM, кнопка
  закрытия задачи, журнал «что и куда записано с причиной».
- Под полем ввода — компактная строка: `sys`, `LTM`, `WM`, `STM`, `req`,
  суммарный prompt, процент контекста и стоимость, плюс сегментированный бар.
- Карточки «Обмены» и блок «Масштаб контекста» на Day 11 отсутствуют.
- Русский интерфейс, визуальная система Flash Chat, интерактивные области
  минимум 44×44 px, видимый focus, без горизонтального overflow.

## Ошибки и стоимость

- Обмен сохраняется одной транзакцией только после полного стрима; сбой роутера
  не мешает сохранению и логируется один раз.
- Роутер — один запрос без retry, ограниченный `max_tokens`; его токены и
  стоимость сохраняются в `memory_exchange_usage` и показываются отдельно.
- Ключи и секреты остаются на сервере, в `.env.local`.

## Проверка

- `npm run test:memory` — store (CRUD, upsert, каскад), composer (порядок,
  бюджеты, разбивка, тумблеры), router (валидный и мусорный JSON), agent
  (сохранение обмена при сбое роутера, отсутствие выключенного слоя в промпте).
- `npm run test:persistence`, `npm run test:tokens` — регресс Day 7 и Day 8.
- `npm run lint -- <файлы>`, `npx tsc --noEmit`, `npm run build` перед
  интеграцией.
- Живой сценарий: факт сохраняется в LTM в одном диалоге, используется в новом
  диалоге, при выключенном LTM тот же вопрос даёт ответ без этого факта.

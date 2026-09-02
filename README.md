# Flash Chat

Проект для челленджа **AI Advent Challenge #9**, задание **Day 1**.
Автор: **Roman Sukhin** (@mimiq43).

Лендинг-плейграунд для диалога с любой OpenAI-совместимой моделью (DeepSeek,
OpenAI, OpenRouter, Ollama и т.п.): стриминговые ответы через серверный маршрут
Next.js, API-ключ не покидает сервер.

Стек: Next.js 16 (App Router), TypeScript, Tailwind CSS v4.

## Задания челленджа

| День  | Ветка   | Страница | Суть                                                        |
| ----- | ------- | -------- | ----------------------------------------------------------- |
| Day 1 | `day-1` | `/`      | Лендинг-чат со стримингом и Markdown-рендером               |
| Day 2 | `day-2` | `/day-2` | Контроль формата ответа: свободный vs строгий JSON-агент    |

## Day 2: формат ответа

Один и тот же запрос уходит дважды и сравнивается бок о бок:

- **Без ограничений** — настройки по умолчанию (у deepseek-v4-flash при этом
  включён thinking-режим).
- **Агент «Кино-консьерж»** — тематический агент с жёстким контролем ответа:
  - system prompt: тема «кино», схема ответа и пример;
  - `response_format: {"type":"json_object"}` — строгий JSON;
  - `max_tokens: 600` — лимит длины;
  - `stop: ["END"]` + инструкция «после JSON напиши END» — условие завершения;
  - `thinking: {"type":"disabled"}` — отключение размышлений ради
    предсказуемости.

Вопрос не по теме кино получает JSON-отказ `{"status":"refused", ...}`.
Конфигурация агента — `src/lib/day2.ts`, страница сравнения —
`src/components/compare.tsx`.

## Запуск

```bash
cp .env.example .env.local   # заполните OPENAI_BASE_URL, OPENAI_API_KEY, OPENAI_MODEL
npm install
npm run dev
```

Приложение поднимется на http://localhost:3000.

## Конфигурация (.env.local)

- `OPENAI_BASE_URL` — базовый URL провайдера, например `https://api.deepseek.com/v1`.
- `OPENAI_API_KEY` — ключ API.
- `OPENAI_MODEL` — имя модели, например `deepseek-v4-flash`. Показывается на
  сайте динамически.

## Как устроено

- `src/app/page.tsx` — лендинг с встроенным чатом; имя модели берётся из env на
  каждый запрос.
- `src/components/chat.tsx` — клиентский чат на весь первый экран: стриминг,
  остановка генерации, кнопка «Новый диалог», состояния пустого диалога и
  ошибок; ответы модели рендерятся как Markdown (react-markdown + remark-gfm,
  стили — @tailwindcss/typography).
- `src/app/api/chat/route.ts` — серверный маршрут: проксирует запрос в
  OpenAI-совместимый API (`stream: true`), превращает SSE в текстовый поток.
  Без заполненного env отвечает явной ошибкой.

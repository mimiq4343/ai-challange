# Flash Chat

Проект для челленджа **AI Advent Challenge #9**, задание **Day 1**.
Автор: **Roman Sukhin** (@mimiq43).

Лендинг-плейграунд для диалога с любой OpenAI-совместимой моделью (DeepSeek,
OpenAI, OpenRouter, Ollama и т.п.): стриминговые ответы через серверный маршрут
Next.js, API-ключ не покидает сервер.

Стек: Next.js 16 (App Router), TypeScript, Tailwind CSS v4.

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

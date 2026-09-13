# Flash Agent

Проект для челленджа **AI Advent Challenge #9**, задание **Day 7**.
Автор: **Roman Sukhin** (@mimiq43).

Многодиалоговый AI-агент с постоянной памятью. История хранится в SQLite,
восстанавливается после полного перезапуска приложения и передаётся LLM при
продолжении каждого разговора.

Стек: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4,
встроенный `node:sqlite`. Требуется Node.js **22.13 или новее**.

## Задание Day 7: сохранение контекста

Пользователь создаёт несколько независимых диалогов, переключается между ними
через sidebar и удаляет ненужные вместе с сообщениями. Последний активный
диалог серверно загружается при открытии страницы `/day-7`.

```text
Browser → conversation API → PersistentChatAgent → SQLite history
                                      │
                                      └→ ChatAgent → LLM
```

`PersistentChatAgent` перед каждым вызовом загружает сообщения выбранного
диалога из SQLite и добавляет новый запрос. `ChatAgent` отвечает за system
prompt, OpenAI-совместимый HTTP API и разбор SSE.

Ответ продолжает идти потоково. Только после штатного завершения потока
`PersistentChatAgent` одной транзакцией сохраняет пару `user + assistant`.
Оборванный ответ не оставляет в контексте половину обмена.

## SQLite

Файл истории создаётся автоматически:

```text
data/chat.sqlite
```

SQLite работает в WAL-режиме, foreign keys включены. Две таблицы хранят
диалоги и связанные сообщения; удаление диалога каскадно удаляет историю.
Файлы SQLite, WAL и SHM исключены из git.

## Как запустить

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

Откройте [http://localhost:3000/day-7](http://localhost:3000/day-7).

Подойдёт любой провайдер с OpenAI-совместимым методом
`POST /chat/completions`: DeepSeek, OpenAI, OpenRouter или локальный Ollama.
API-ключ остаётся на сервере.

## API

```text
GET    /api/conversations
POST   /api/conversations
GET    /api/conversations/:id
DELETE /api/conversations/:id
POST   /api/conversations/:id/messages
```

Браузер отправляет агенту только ID диалога и новое сообщение. Сохранённую
историю загружает сервер — клиент не может подменить прежний контекст.

## Проверка хранилища

```bash
npm run test:persistence
```

Тесты создают временную SQLite, закрывают и повторно открывают соединение,
проверяют восстановление, каскадное удаление и запрет сохранения оборванного
ответа.

Практический сценарий:

1. Сообщить агенту кодовое слово.
2. Дождаться полного ответа.
3. Полностью остановить и снова запустить `npm run dev`.
4. Открыть `/day-7` и спросить кодовое слово без повторной подсказки.
5. Убедиться, что агент отвечает из восстановленной истории.

## Структура Day 7

```text
src/
  app/
    api/conversations/                  REST API диалогов
    day-7/page.tsx                      серверная начальная загрузка
  components/
    conversation-sidebar.tsx            список, создание и удаление
    conversation-workspace.tsx          чат и переключение диалогов
  lib/
    chat-agent.ts                       вызов LLM
    conversation-store.ts               SQLite и транзакции
    conversation-types.ts               общие контракты
    persistent-chat-agent.ts            восстановление контекста
tests/
  conversation-store.test.ts
  persistent-chat-agent.test.ts
```

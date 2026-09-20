# Day 7 Context Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Repository policy disables subagent-driven execution.

**Goal:** Сохранять несколько диалогов агента в SQLite, восстанавливать их после полного рестарта Next.js и продолжать разговор с прежним контекстом.

**Architecture:** `SqliteConversationStore` владеет БД и атомарными записями. `PersistentChatAgent` композиционно использует существующий `ChatAgent`, загружает историю выбранного диалога и сохраняет только полностью завершённый обмен. REST API обслуживает sidebar и чат, а `/day-7` серверно загружает начальное состояние.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Node.js 24 `node:sqlite`, Tailwind CSS 4, Phosphor Icons, `node:test` через `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-13-day-7-context-persistence-design.md`

## Глобальные ограничения

- Node.js 24.19.0; минимальная документированная версия — 22.13.
- Только встроенный `node:sqlite`; без ORM и runtime-зависимости SQLite.
- Runtime-файл — `data/chat.sqlite`; SQLite, WAL и SHM не попадают в git.
- `/api/chat`, `ChatAgent`, `Chat` и `/day-6` сохраняют поведение.
- Пара `user + assistant` сохраняется одной транзакцией после полного ответа.
- UI использует существующие токены Flash Chat, Markdown и motion-safe анимации.
- Интерактивные области — минимум 44×44 px, keyboard focus видим.
- Каждый source-файл — меньше 800 строк.

## Этапы

1. [`01-storage-and-agent.md`](./01-storage-and-agent.md) — SQLite store, persistent-agent, red-green тесты.
2. [`02-api-and-interface.md`](./02-api-and-interface.md) — REST API, sidebar, workspace, страница Day 7.
3. [`03-verification-and-publication.md`](./03-verification-and-publication.md) — README, полный рестарт, проверка памяти и удаления, финальные проверки.

Этапы выполняются строго по порядку: API зависит от store и persistent-agent; UI зависит от API; рестарт-проверка зависит от всего приложения.

## Карта файлов

| Файл | Ответственность |
| --- | --- |
| `src/lib/conversation-types.ts` | Общие типы диалогов и сообщений |
| `src/lib/conversation-store.ts` | Схема SQLite, запросы и транзакции |
| `src/lib/persistent-chat-agent.ts` | Загрузка контекста, LLM-вызов, сохранение обмена |
| `src/app/api/conversations/route.ts` | Список и создание диалогов |
| `src/app/api/conversations/[id]/route.ts` | Чтение и удаление диалога |
| `src/app/api/conversations/[id]/messages/route.ts` | Потоковый ответ persistent-agent |
| `src/components/conversation-sidebar.tsx` | Desktop sidebar, mobile drawer, удаление |
| `src/components/conversation-workspace.tsx` | Клиентское состояние и потоковый чат |
| `src/app/day-7/page.tsx` | Серверная начальная загрузка и композиция страницы |
| `tests/conversation-store.test.ts` | Восстановление SQLite между экземплярами |
| `tests/persistent-chat-agent.test.ts` | Сохранение полного и отказ от частичного обмена |

## Контракты

```ts
export type MessageRole = "user" | "assistant";

export type ConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type StoredMessage = {
  id: number;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
};

export type ConversationDetail = {
  conversation: ConversationSummary;
  messages: StoredMessage[];
};
```

```ts
new SqliteConversationStore(databasePath: string)
store.listConversations(): ConversationSummary[]
store.createConversation(): ConversationSummary
store.getConversation(id: string): ConversationSummary | null
store.getMessages(conversationId: string): StoredMessage[]
store.saveExchange(conversationId: string, userContent: string, assistantContent: string): ConversationSummary
store.deleteConversation(id: string): boolean
store.close(): void
```

```ts
new PersistentChatAgent(store, llm)
PersistentChatAgent.fromEnvironment(store?): PersistentChatAgent
agent.respond(conversationId: string, content: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array>>
```

## Коммиты

1. `feat(day-7): persist conversations in SQLite`
2. `feat(day-7): restore context before LLM calls`
3. `feat(day-7): expose conversation API`
4. `feat(day-7): add persistent chat workspace`
5. `docs(day-7): document persistent conversations`

Пустой финальный коммит после проверок не создаётся.

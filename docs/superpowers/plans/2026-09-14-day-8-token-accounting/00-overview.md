# Day 8 Token Accounting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Repository policy disables subagent-driven execution.

**Goal:** Измерять токены запроса, истории и ответа, сохранять provider usage и стоимость, показывать рост контекста и выполнять реальный overflow-запрос к бесплатной модели с окном 32,768 токенов.

**Architecture:** `ChatAgent` возвращает text stream вместе с финальным usage. Server-only token counters используют локальные официальные tokenizer assets для DeepSeek V4 и NVIDIA Nemotron. `PersistentChatAgent` выполняет preflight, после полного stream атомарно сохраняет сообщения и usage в SQLite; отдельный `OverflowExperimentService` выполняет один реальный OpenRouter Embeddings запрос сверх лимита.

**Tech Stack:** Next.js 16.3.4, React 19.2.8, TypeScript 5, Node.js 24 `node:sqlite`, Tailwind CSS 4, `@huggingface/transformers` 4.2.0, Phosphor Icons, `node:test` через `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-14-day-8-token-accounting-design.md`

## Глобальные ограничения

- Работа ведётся только в ветке `day-8`, созданной от актуального `main`.
- `/day-6`, `/api/chat`, `/day-7` и существующие conversation API сохраняют наблюдаемое поведение.
- Live model — `deepseek-v4-flash`; context window 1,000,000, output reserve и `max_tokens` — 4,096.
- Overflow model — `nvidia/nemotron-3-embed-1b:free`; endpoint `/embeddings`, context window 32,768, target input 33,280, стоимость $0.
- `OPENROUTER_API_KEY` хранится только в `.env.local`; `.env.example` содержит пустое значение.
- Tokenizer assets локальные и server-only; remote model loading выключен.
- Provider usage — источник истины для prompt/completion totals; локальная request/history разбивка помечается estimate.
- `user + assistant + exchange_usage` сохраняются одной транзакцией только после полного stream.
- Огромный overflow input и embedding vector никогда не сохраняются и не логируются.
- Retry отсутствует во всех новых внешних вызовах.
- TDD не применяется. Контрактные тесты добавляются после production implementation.
- UI-навык — `ui-ux-pro-max`; сохраняются токены и визуальный язык Flash Chat.
- Интерактивные области — минимум 44×44 px; keyboard focus видим; horizontal overflow отсутствует.
- Каждый source-файл остаётся меньше 800 строк.
- `main` и remote не меняются без отдельной команды пользователя.

## Этапы

1. [`01-tokenizer-and-model.md`](./01-tokenizer-and-model.md) — зависимости, официальные assets, model profiles, стоимость, token counter и preflight.
2. [`02-agent-storage-and-api.md`](./02-agent-storage-and-api.md) — usage из SSE, SQLite migration, атомарное сохранение, analytics API.
3. [`03-real-overflow-experiment.md`](./03-real-overflow-experiment.md) — реальный OpenRouter Embeddings overflow и классификация результата.
4. [`04-interface-and-verification.md`](./04-interface-and-verification.md) — `/day-8`, аналитика, сравнение, документация и практическая проверка.

Этапы выполняются по порядку. Agent/storage зависит от token contracts; overflow зависит от Nemotron counter; UI зависит от всех API.

## Карта файлов

| Файл | Ответственность |
| --- | --- |
| `package.json`, `package-lock.json` | Transformers.js и test script |
| `tokenizers/manifest.json` | Источник, revision, размер и SHA-256 assets |
| `tokenizers/deepseek-v4/*` | Официальный DeepSeek V4 tokenizer |
| `tokenizers/nemotron-3-embed-1b/*` | Официальный NVIDIA tokenizer |
| `src/lib/model-profiles.ts` | Context limits, output reserve, тарифы и model IDs |
| `src/lib/token-counter.ts` | Ленивая server-only загрузка tokenizer и token breakdown |
| `src/lib/token-cost.ts` | Peak/off-peak и micro-USD расчёт |
| `src/lib/chat-agent.ts` | Text stream плюс финальный provider usage |
| `src/lib/conversation-types.ts` | Usage, analytics и overflow DTO |
| `src/lib/conversation-store.ts` | `exchange_usage`, `overflow_runs`, транзакции и queries |
| `src/lib/persistent-chat-agent.ts` | Preflight, stream, local/provider usage, atomic persistence |
| `src/lib/token-analytics.ts` | Timeline, cumulative totals, short/long fixtures |
| `src/lib/overflow-experiment.ts` | Единственный реальный OpenRouter overflow request |
| `src/app/api/conversations/[id]/usage/route.ts` | Analytics выбранного диалога |
| `src/app/api/token-experiments/comparison/route.ts` | Offline short/long comparison и последний overflow run |
| `src/app/api/token-experiments/overflow/route.ts` | Confirmed real overflow boundary |
| `src/components/conversation-workspace.tsx` | Необязательные lifecycle callbacks для Day 8 |
| `src/components/day8-workspace.tsx` | Композиция чата и аналитики |
| `src/components/token-analytics-panel.tsx` | Totals, context meter и exchange bars |
| `src/components/token-comparison.tsx` | Short/long/overflow comparison и real-test control |
| `src/app/day-8/page.tsx` | Server initial data и метаданные страницы |
| `tests/token-counter.test.ts` | Tokenizer fixture и context boundaries |
| `tests/token-cost.test.ts` | Cache и tariff bands |
| `tests/chat-agent-usage.test.ts` | Последний SSE usage event |
| `tests/conversation-usage.test.ts` | Atomic usage, legacy estimates и cascade |
| `tests/overflow-experiment.test.ts` | Rejected/truncated/accepted classification |

## Сквозные контракты

```ts
export type TokenSource = "provider" | "estimated";
export type TariffBand = "peak" | "off-peak";

export type TokenBreakdown = {
  systemTokens: number;
  historyTokens: number;
  requestTokens: number;
  promptTokens: number;
  reservedOutputTokens: number;
  contextTokens: number;
  contextLimit: number;
};

export type ProviderTokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheHitTokens: number | null;
  cacheMissTokens: number | null;
};

export type ChatAgentResponse = {
  stream: ReadableStream<Uint8Array>;
  usage: Promise<ProviderTokenUsage | null>;
};
```

```ts
export type ExchangeUsageInput = TokenBreakdown & {
  model: string;
  responseTokens: number;
  providerUsage: ProviderTokenUsage | null;
  source: TokenSource;
  tariffBand: TariffBand;
  costMicrosUsd: number;
};

store.saveExchange(
  conversationId: string,
  userContent: string,
  assistantContent: string,
  usage?: ExchangeUsageInput,
): ConversationSummary;

store.getConversationUsage(conversationId: string): StoredExchangeUsage[];
store.saveOverflowRun(input: OverflowRunInput): OverflowRun;
store.getLatestOverflowRun(): OverflowRun | null;
```

```ts
export type OverflowOutcome = "rejected" | "truncated" | "accepted" | "network_error";

export type OverflowRun = {
  id: number;
  model: "nvidia/nemotron-3-embed-1b:free";
  contextLimit: 32768;
  localInputTokens: number;
  providerInputTokens: number | null;
  outcome: OverflowOutcome;
  httpStatus: number | null;
  errorMessage: string | null;
  durationMs: number;
  costMicrosUsd: 0;
  createdAt: string;
};
```

## Коммиты

1. `feat(day-8): add model token accounting`
2. `feat(day-8): persist provider usage`
3. `feat(day-8): run real context overflow experiment`
4. `feat(day-8): visualize token growth`
5. `docs(day-8): document token behavior`

Пустой финальный коммит после проверок не создаётся.

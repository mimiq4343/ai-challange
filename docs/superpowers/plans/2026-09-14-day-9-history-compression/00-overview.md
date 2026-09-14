# Day 9 History Compression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Repository policy disables subagent-driven execution.

**Goal:** Сохранять полную историю, подставлять модели накопительный summary и последние 10 исходных сообщений, измерять экономию и сравнивать качество full/compressed ответов слепым LLM-судьёй.

**Architecture:** `CompressedChatAgent` обновляет immutable summary checkpoints блоками по 10 сообщений, считает full и effective prompts, затем стримит основной ответ через существующий `ChatAgent`. SQLite отдельно хранит summary, exchange compression metrics и benchmark runs. `/day-9` переиспользует Day 8 workspace без блока «Масштаб контекста» и показывает live savings плюс фиксированный четырёхвызовный benchmark.

**Tech Stack:** Next.js 16.3.4, React 19.2.8, TypeScript 5, Node.js 24 `node:sqlite`, Tailwind CSS 4, `@huggingface/transformers` 4.2.0, Phosphor Icons, `node:test` через `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-14-day-9-history-compression-design.md`

## Глобальные ограничения

- Работа ведётся только в ветке `day-9`, созданной от `main` commit `4b504e0`.
- Пользователь отказался от отдельного worktree; текущий checkout переключён на `day-9`.
- `/day-7`, `/day-8`, `/api/chat` и full-history messages endpoint сохраняют наблюдаемое поведение.
- Full `messages` никогда не удаляются и не переписываются.
- Raw tail — последние 10 отдельных сообщений; summary batch — ровно 10 сообщений.
- Summary обновляется incrementally и ограничен 512 output tokens.
- Summary failure останавливает основной compressed request; full-history fallback запрещён.
- Live, summary, benchmark answer и judge используют текущую `deepseek-v4-flash`.
- Benchmark выполняет ровно четыре последовательных вызова без автоматического retry.
- Provider usage — источник истины; локальный DeepSeek tokenizer даёт preflight и breakdown.
- Поведенческие параметры находятся в version-controlled TypeScript, не в env vars.
- TDD не применяется: production implementation создаётся первой, затем остаются только contract tests с реальным риском регрессии.
- UI сохраняет визуальный язык Flash Chat и структуру Day 8, но Day 9 не рендерит `TokenComparison` и overflow controls.
- Интерактивные области — минимум 44×44 px; focus видим; horizontal overflow отсутствует.
- Каждый source-файл остаётся меньше 800 строк. Если `conversation-store.ts` приблизится к лимиту, benchmark persistence выделяется в `compression-run-store.ts`, а не добавляется в основной store.
- Секреты не читаются в клиент и не попадают в логи, SQLite, тестовые fixtures или commits.
- Публикация и merge выполняются только после зелёной merged verification и команды пользователя.

## Этапы

1. [`01-contracts-and-storage.md`](./01-contracts-and-storage.md) — compression contracts, чистая window policy, SQLite checkpoints и atomic exchange metrics.
2. [`02-compressed-agent-and-api.md`](./02-compressed-agent-and-api.md) — расширение ChatAgent/token counter, summarizer, compressed stream и analytics endpoint.
3. [`03-quality-benchmark.md`](./03-quality-benchmark.md) — фиксированный transcript, четыре LLM-вызова, blind judge, persistence и API.
4. [`04-interface-and-verification.md`](./04-interface-and-verification.md) — Day 9 UI без «Масштаба контекста», реальные проверки, документация и integration gates.

Этапы выполняются по порядку. Store contracts нужны agent layer; compressed agent нужен live analytics; benchmark не зависит от live conversation mutations, но переиспользует ChatAgent options и cost calculation; UI зависит от обоих API.

## Карта файлов

| Файл | Ответственность |
| --- | --- |
| `src/lib/compression-types.ts` | Checkpoint, exchange metrics, analytics и benchmark DTO |
| `src/lib/history-compression.ts` | Константы, pure window selection и prompt formatting |
| `src/lib/conversation-types.ts` | `ChatRequestOptions` и расширение atomic exchange input |
| `src/lib/conversation-store.ts` | Summary/exchange compression DDL, queries и atomic save |
| `src/lib/compression-run-store.ts` | `compression_runs` DDL и latest/save methods |
| `src/lib/chat-agent.ts` | Несколько system messages и per-call output limit |
| `src/lib/token-counter.ts` | Exact preflight для нескольких system messages |
| `src/lib/history-summarizer.ts` | Последовательное обновление checkpoints |
| `src/lib/compressed-chat-agent.ts` | Full/effective preflight, stream и atomic persistence |
| `src/lib/compression-analytics.ts` | Live timeline и cumulative savings |
| `src/lib/compression-benchmark.ts` | Четырёхвызовный benchmark и strict judge parser |
| `src/app/api/conversations/[id]/compressed-messages/route.ts` | Compressed stream boundary и headers |
| `src/app/api/conversations/[id]/compression/route.ts` | Live compression analytics |
| `src/app/api/compression-experiments/route.ts` | Confirmed benchmark POST |
| `src/app/api/compression-experiments/latest/route.ts` | Latest benchmark GET |
| `src/components/conversation-workspace.tsx` | Optional message route и raw response-header callback |
| `src/components/compression-analytics-panel.tsx` | Full/effective bars, savings и summary detail |
| `src/components/compression-benchmark-panel.tsx` | Answers, judge scores, tokens, cost, confirmation |
| `src/components/day9-workspace.tsx` | Chat/analytics/benchmark composition |
| `src/app/day-9/page.tsx` | Server initial data и metadata |
| `src/components/site-header.tsx` | Day 9 navigation |
| `tests/history-compression.test.ts` | 9/10/19/20/30 window boundaries |
| `tests/conversation-compression.test.ts` | SQLite persistence, atomicity и cascade |
| `tests/chat-agent-options.test.ts` | System messages и max token request body |
| `tests/compressed-chat-agent.test.ts` | Summary gating, request composition и stream failure |
| `tests/compression-benchmark.test.ts` | Four calls, blind mapping, judge validation и savings |

## Сквозные контракты

```ts
export const RAW_TAIL_MESSAGES = 10;
export const SUMMARY_BATCH_MESSAGES = 10;
export const SUMMARY_MAX_OUTPUT_TOKENS = 512;

export type ChatRequestOptions = {
  systemMessages?: readonly string[];
  maxOutputTokens?: number;
};
```

```ts
export type SummaryCheckpoint = {
  id: number;
  conversationId: string;
  summarizedThroughMessageId: number;
  summarizedMessageCount: number;
  content: string;
  model: string;
  providerPromptTokens: number | null;
  providerCompletionTokens: number | null;
  costMicrosUsd: number;
  createdAt: string;
};

export type CompressionPreflight = {
  full: TokenBreakdown;
  compressed: TokenBreakdown;
  summaryId: number | null;
  summaryTokens: number;
  rawTailTokens: number;
  rawTailMessageCount: number;
  summarizedMessageCount: number;
  grossSavedTokens: number;
};
```

```ts
export type ExchangeCompressionInput = {
  summaryId: number | null;
  rawTailMessageCount: number;
  fullPromptTokens: number;
  compressedPromptTokens: number;
  summaryTokens: number;
  rawTailTokens: number;
  grossSavedTokens: number;
};

store.saveExchange(
  conversationId: string,
  userContent: string,
  assistantContent: string,
  usage?: ExchangeUsageInput,
  compression?: ExchangeCompressionInput,
): ConversationSummary;
```

```ts
export type CompressionWindow = {
  batch: StoredMessage[];
  rawTail: StoredMessage[];
};

export function selectCompressionWindow(
  messagesAfterCursor: readonly StoredMessage[],
): CompressionWindow;
```

```ts
export type CompressedChatResponse = {
  stream: ReadableStream<Uint8Array>;
  preflight: CompressionPreflight;
};
```

## Commit boundaries

1. `feat(day-9): persist history summaries`
2. `feat(day-9): compress live conversation context`
3. `feat(day-9): compare compressed response quality`
4. `feat(day-9): visualize context savings`
5. `docs(day-9): document history compression`

Пустой финальный commit после проверок не создаётся.

# Этап 1: compression contracts, window policy и SQLite

## Task 1: Зафиксировать типы и чистую политику окна

**Files:**
- Create: `src/lib/compression-types.ts`
- Create: `src/lib/history-compression.ts`
- Modify: `src/lib/conversation-types.ts`
- Create: `tests/history-compression.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes existing `StoredMessage`, `TokenBreakdown`, `ProviderTokenUsage`, `TokenSource` and `TariffBand`.
- Produces constants, persisted DTOs, `CompressionWindow`, `CompressionPreflight` and pure calculations used by live and benchmark paths.

- [ ] **Step 1: Add version-controlled compression constants**

Create `src/lib/history-compression.ts` with exact behavior settings:

```ts
export const RAW_TAIL_MESSAGES = 10;
export const SUMMARY_BATCH_MESSAGES = 10;
export const SUMMARY_MAX_OUTPUT_TOKENS = 512;
export const COMPRESSION_MODEL = DEEPSEEK_FLASH_PROFILE.id;
```

Add fixed `SUMMARY_SYSTEM_PROMPT` and `SUMMARY_CONTEXT_PREFIX` strings in the same server-only module. The prompt must require preservation of facts, decisions, constraints, preferences, unfinished tasks and causal relationships; forbid invented details; remove greetings, repetition and intermediate chatter. Do not read these values from environment variables.

- [ ] **Step 2: Implement the pure window selector**

Expose:

```ts
export type CompressionWindow = {
  batch: StoredMessage[];
  rawTail: StoredMessage[];
};

export function selectCompressionWindow(
  messagesAfterCursor: readonly StoredMessage[],
): CompressionWindow;
```

Rules:

1. `rawTail` is always the final `min(length, 10)` messages, preserving DB order and content byte-for-byte.
2. `compressibleCount = length - rawTail.length`.
3. `batch` is the first 10 messages only when `compressibleCount >= 10`; otherwise it is empty.
4. Messages between `batch` and `rawTail` may exist only during a multi-checkpoint catch-up and remain pending for the next loop iteration; nothing is dropped.
5. The function never mutates its input.

This yields no checkpoint for 0–19 pending messages, one batch for 20–29 and a repeated loop for 30+.

- [ ] **Step 3: Add exact summary input formatting**

Expose:

```ts
export function buildSummaryRequest(
  previousSummary: string | null,
  batch: readonly ChatMessage[],
): string;
```

Reject any batch whose length is not exactly 10. Serialize the previous summary as one JSON value and every message as one JSON object with explicit `role` and `content` fields:

```text
PREVIOUS SUMMARY
null

NEXT 10 ORIGINAL MESSAGES
{"role":"user","content":"Срок — 15 мая."}
{"role":"assistant","content":"Запомнил срок: 15 мая."}
```

The real block contains exactly 10 JSON message lines. The previous summary is included once when present. Content remains data: delimiter-like text inside a message cannot alter the summarization instructions.

- [ ] **Step 4: Define persisted live-compression contracts**

Create `src/lib/compression-types.ts` with these public shapes:

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

export type SummaryCheckpointInput = Omit<
  SummaryCheckpoint,
  "id" | "conversationId" | "createdAt"
>;

export type ExchangeCompressionInput = {
  summaryId: number | null;
  rawTailMessageCount: number;
  fullPromptTokens: number;
  compressedPromptTokens: number;
  summaryTokens: number;
  rawTailTokens: number;
  grossSavedTokens: number;
};

export type StoredExchangeCompression = ExchangeCompressionInput & {
  assistantMessageId: number;
  conversationId: string;
  providerPromptTokens: number | null;
  providerCompletionTokens: number | null;
  source: TokenSource;
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

export type ConversationCompressionAnalytics = {
  latestSummary: SummaryCheckpoint | null;
  summarizedMessageCount: number;
  rawTailMessageCount: number;
  exchanges: StoredExchangeCompression[];
  totals: {
    fullPromptTokens: number;
    compressedPromptTokens: number;
    grossSavedTokens: number;
    summaryPromptTokens: number;
    summaryCompletionTokens: number;
    summaryCostMicrosUsd: number;
    compressedProviderPromptTokens: number;
    compressedProviderCompletionTokens: number;
    compressedCostMicrosUsd: number;
    providerExchangeCount: number;
    estimatedExchangeCount: number;
  };
};
```

`grossSavedTokens` is signed. Provider, source and cost fields in `StoredExchangeCompression` come from the matching `exchange_usage` row; do not duplicate them in SQLite. Summary provider totals come from immutable checkpoints. Derived totals are calculated at read time, not stored as mutable counters.

- [ ] **Step 5: Extend the atomic exchange signature**

Add optional compression input without changing existing callers:

```ts
saveExchange(
  conversationId: string,
  userContent: string,
  assistantContent: string,
  usage?: ExchangeUsageInput,
  compression?: ExchangeCompressionInput,
): ConversationSummary;
```

A compression row requires a usage row because provider usage and cost are joined from `exchange_usage`. Calls from Day 7/8 remain valid with existing arguments.

- [ ] **Step 6: Add post-implementation policy tests**

`tests/history-compression.test.ts` must assert observable boundaries:

- 9, 10 and 19 pending messages produce no batch and preserve the final up-to-10 raw messages;
- 20 messages produce batch IDs 1–10 and raw-tail IDs 11–20;
- 30 messages, after applying the returned cursor and selecting again, produce two consecutive batches with no gaps and final IDs 21–30 unchanged;
- returned arrays and content preserve input order and do not mutate the fixture;
- summary request rejects 9/11-message batches and includes the previous summary plus exactly 10 role-labelled JSON strings.

Do not assert source text or internal helper calls.

- [ ] **Step 7: Add and run the focused test command**

Add:

```json
"test:compression": "node --conditions=react-server --import tsx --test tests/history-compression.test.ts tests/conversation-compression.test.ts tests/chat-agent-options.test.ts tests/compressed-chat-agent.test.ts tests/compression-benchmark.test.ts"
```

At this task boundary only `history-compression.test.ts` exists. Run:

```bash
node --conditions=react-server --import tsx --test tests/history-compression.test.ts
npm run lint -- src/lib/history-compression.ts src/lib/compression-types.ts src/lib/conversation-types.ts tests/history-compression.test.ts
npx tsc --noEmit
```

Expected: window boundaries and type contracts pass; package script may reference later test files but is not invoked until those files exist.

## Task 2: Сохранить immutable checkpoints и atomic exchange metrics

**Files:**
- Modify: `src/lib/conversation-store.ts`
- Modify: `src/lib/compression-types.ts`
- Modify: `tests/conversation-store.test.ts`
- Create: `tests/conversation-compression.test.ts`

**Interfaces:**
- Consumes `SummaryCheckpointInput` and `ExchangeCompressionInput`.
- Produces idempotent additive schema, ordered summary/compression queries and a single atomic exchange transaction.

- [ ] **Step 1: Add idempotent STRICT tables**

Extend store initialization with exact additive DDL:

```sql
CREATE TABLE IF NOT EXISTS conversation_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  summarized_through_message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  summarized_message_count INTEGER NOT NULL
    CHECK (summarized_message_count > 0 AND summarized_message_count % 10 = 0),
  content TEXT NOT NULL CHECK (length(content) > 0),
  model TEXT NOT NULL,
  provider_prompt_tokens INTEGER CHECK (provider_prompt_tokens >= 0),
  provider_completion_tokens INTEGER CHECK (provider_completion_tokens >= 0),
  cost_micros_usd INTEGER NOT NULL CHECK (cost_micros_usd >= 0),
  created_at TEXT NOT NULL,
  UNIQUE (conversation_id, summarized_through_message_id)
) STRICT;

CREATE INDEX IF NOT EXISTS conversation_summaries_latest
ON conversation_summaries(conversation_id, summarized_message_count DESC, id DESC);

CREATE TABLE IF NOT EXISTS exchange_compression (
  assistant_message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  summary_id INTEGER REFERENCES conversation_summaries(id) ON DELETE SET NULL,
  raw_tail_message_count INTEGER NOT NULL
    CHECK (raw_tail_message_count BETWEEN 0 AND 10),
  full_prompt_tokens INTEGER NOT NULL CHECK (full_prompt_tokens >= 0),
  compressed_prompt_tokens INTEGER NOT NULL CHECK (compressed_prompt_tokens >= 0),
  summary_tokens INTEGER NOT NULL CHECK (summary_tokens >= 0),
  raw_tail_tokens INTEGER NOT NULL CHECK (raw_tail_tokens >= 0),
  gross_saved_tokens INTEGER NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS exchange_compression_conversation_created
ON exchange_compression(conversation_id, created_at, assistant_message_id);
```

Do not add update/delete methods for checkpoints. Conversation deletion owns lifecycle through foreign keys.

- [ ] **Step 2: Add ordered message and checkpoint queries**

Expose:

```ts
getMessagesAfter(
  conversationId: string,
  summarizedThroughMessageId: number | null,
): StoredMessage[];
getLatestConversationSummary(conversationId: string): SummaryCheckpoint | null;
getConversationSummaries(conversationId: string): SummaryCheckpoint[];
getConversationCompression(conversationId: string): StoredExchangeCompression[];
```

Messages and exchange rows order by their numeric IDs. Latest checkpoint orders by `summarized_message_count DESC, id DESC`. Unknown conversation behavior matches `getConversation()` and is mapped at the HTTP boundary.

- [ ] **Step 3: Save one checkpoint transactionally and immutably**

Expose:

```ts
saveConversationSummary(
  conversationId: string,
  input: SummaryCheckpointInput,
): SummaryCheckpoint;
```

Within `BEGIN IMMEDIATE`:

1. verify conversation exists;
2. verify cursor message exists in the same conversation;
3. verify the count of that conversation's messages through the cursor equals `summarizedMessageCount`;
4. verify the new count is exactly the latest checkpoint count plus 10, or 10 when no checkpoint exists;
5. reject blank summary, missing provider usage and non-finite/negative cost;
6. insert one row and return it after `COMMIT`.

On any failure, `ROLLBACK`. Never rewrite an earlier checkpoint. Successful checkpoints from previous iterations remain committed when a later summary call fails.

- [ ] **Step 4: Extend the existing exchange transaction**

Keep the existing `BEGIN IMMEDIATE` transaction and insertion order:

1. user message;
2. assistant message and captured `assistant_message_id`;
3. optional `exchange_usage`;
4. optional `exchange_compression` using the same assistant ID;
5. conversation title/timestamp;
6. `COMMIT`.

Before insertion, reject `compression` without `usage`; verify non-null `summaryId` belongs to the same conversation. Any compression constraint or insert failure rolls back user, assistant and usage together. Existing Day 7/8 no-compression calls are unchanged.

- [ ] **Step 5: Join provider totals into compression reads**

`getConversationCompression()` must `LEFT JOIN exchange_usage` on `assistant_message_id` and map:

```ts
providerPromptTokens: row.provider_prompt_tokens,
providerCompletionTokens: row.provider_completion_tokens,
costMicrosUsd: row.cost_micros_usd,
```

A missing joined usage row is a store invariant violation, not zero usage.

- [ ] **Step 6: Add post-implementation persistence tests**

Use temporary SQLite files and close every store. Assert:

- opening an existing Day 8 database adds empty Day 9 tables without changing old rows;
- two checkpoints survive close/reopen and the latest query returns the larger cursor;
- blank content, cursor from another conversation, skipped cursor and a count jump other than 10 are rejected;
- forced failure during `exchange_compression` insertion rolls back user, assistant and `exchange_usage`;
- valid compressed exchange joins actual provider usage/cost;
- deleting a conversation cascades summaries and exchange compression;
- existing `saveExchange(..., usage)` and `saveExchange(...)` behavior remains green.

- [ ] **Step 7: Run Stage 1 checks and commit**

```bash
node --conditions=react-server --import tsx --test tests/history-compression.test.ts tests/conversation-store.test.ts tests/conversation-compression.test.ts
npm run lint -- src/lib/history-compression.ts src/lib/compression-types.ts src/lib/conversation-types.ts src/lib/conversation-store.ts tests/history-compression.test.ts tests/conversation-store.test.ts tests/conversation-compression.test.ts
npx tsc --noEmit
wc -l src/lib/conversation-store.ts src/lib/history-compression.ts src/lib/compression-types.ts
```

All source files must remain below 800 lines.

```bash
git add package.json src/lib/history-compression.ts src/lib/compression-types.ts src/lib/conversation-types.ts src/lib/conversation-store.ts tests/history-compression.test.ts tests/conversation-store.test.ts tests/conversation-compression.test.ts
git commit -m "feat(day-9): persist history summaries"
```

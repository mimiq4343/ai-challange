# Этап 2: usage из агента, SQLite и analytics API

## Task 4: Вернуть provider usage из ChatAgent

**Files:**
- Modify: `src/lib/chat-agent.ts`
- Modify: `src/app/api/chat/route.ts`
- Modify: `src/lib/persistent-chat-agent.ts`
- Create: `tests/chat-agent-usage.test.ts`

**Interfaces:**
- Consumes `ProviderTokenUsage` from conversation types.
- Produces `ChatAgentResponse { stream, usage }` for both callers.

- [ ] **Step 1: Move shared usage types into conversation contracts**

Add exact definitions to `src/lib/conversation-types.ts` from `00-overview.md`: `TokenSource`, `TariffBand`, `TokenBreakdown`, `ProviderTokenUsage`, `ChatAgentResponse`, `ExchangeUsageInput`, `StoredExchangeUsage`, `ConversationUsageAnalytics`, `OverflowOutcome`, `OverflowRun` and comparison DTOs.

All token counts are non-negative integers. Costs use `costMicrosUsd: number`; API formatting into dollars occurs only in UI.

- [ ] **Step 2: Extend the request body and SSE event schema**

Send:

```ts
{
  model: this.config.model,
  messages: [{ role: "system", content: INSTRUCTIONS }, ...messages],
  stream: true,
  stream_options: { include_usage: true },
  max_tokens: DEEPSEEK_FLASH_PROFILE.responseReserveTokens,
}
```

Parse usage with explicit runtime validation:

```ts
type ProviderUsageEvent = {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
  prompt_cache_hit_tokens?: unknown;
  prompt_cache_miss_tokens?: unknown;
};
```

Reject negative, fractional or inconsistent totals by treating usage as unavailable; do not fail a valid text stream because optional metadata is malformed.

- [ ] **Step 3: Return stream and a final usage promise**

Refactor `sseToTextStream` to return `ChatAgentResponse`. Resolve `usage` when a valid final event appears; resolve `null` in clean `flush` when the provider omitted it. The returned text bytes remain byte-for-byte equivalent to the previous output.

```ts
const response = await agent.respond(messages, signal);
return new Response(response.stream, {
  headers: { "Content-Type": "text/plain; charset=utf-8" },
});
```

Apply that migration in `/api/chat` so Day 6 keeps its HTTP contract.

- [ ] **Step 4: Update PersistentChatAgent only enough to consume `.stream`**

At this task boundary, preserve the existing save behavior and pass `response.stream` into the existing collecting transform. Full usage persistence lands in Task 6.

- [ ] **Step 5: Add post-implementation SSE tests**

Build a real `ReadableStream` containing multiple SSE chunks, including a final usage event split across chunk boundaries. Assert:

```ts
assert.equal(await new Response(result.stream).text(), "Привет");
assert.deepEqual(await result.usage, {
  promptTokens: 120,
  completionTokens: 8,
  totalTokens: 128,
  cacheHitTokens: 80,
  cacheMissTokens: 40,
});
```

Also cover clean stream without usage and malformed usage that does not corrupt text.

- [ ] **Step 6: Run focused checks**

```bash
npx tsx --test tests/chat-agent-usage.test.ts tests/persistent-chat-agent.test.ts
npm run lint -- src/lib/chat-agent.ts src/app/api/chat/route.ts src/lib/persistent-chat-agent.ts src/lib/conversation-types.ts tests/chat-agent-usage.test.ts
npx tsc --noEmit
```

Expected: Day 6 response text and existing persistent-agent behavior remain green.

## Task 5: Add usage persistence without rewriting old conversations

**Files:**
- Modify: `src/lib/conversation-store.ts`
- Modify: `src/lib/conversation-types.ts`
- Modify: `tests/conversation-store.test.ts`
- Create: `tests/conversation-usage.test.ts`

**Interfaces:**
- Consumes `ExchangeUsageInput`.
- Produces additive schema, optional `saveExchange(..., usage)`, usage timeline and overflow run persistence.

- [ ] **Step 1: Add STRICT tables during store initialization**

Create additive idempotent DDL:

```sql
CREATE TABLE IF NOT EXISTS exchange_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  assistant_message_id INTEGER NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  context_limit INTEGER NOT NULL CHECK (context_limit > 0),
  system_tokens INTEGER NOT NULL CHECK (system_tokens >= 0),
  history_tokens INTEGER NOT NULL CHECK (history_tokens >= 0),
  request_tokens INTEGER NOT NULL CHECK (request_tokens >= 0),
  prompt_tokens INTEGER NOT NULL CHECK (prompt_tokens >= 0),
  reserved_output_tokens INTEGER NOT NULL CHECK (reserved_output_tokens >= 0),
  response_tokens INTEGER NOT NULL CHECK (response_tokens >= 0),
  provider_prompt_tokens INTEGER CHECK (provider_prompt_tokens >= 0),
  provider_completion_tokens INTEGER CHECK (provider_completion_tokens >= 0),
  cache_hit_tokens INTEGER CHECK (cache_hit_tokens >= 0),
  cache_miss_tokens INTEGER CHECK (cache_miss_tokens >= 0),
  source TEXT NOT NULL CHECK (source IN ('provider', 'estimated')),
  tariff_band TEXT NOT NULL CHECK (tariff_band IN ('peak', 'off-peak')),
  cost_micros_usd INTEGER NOT NULL CHECK (cost_micros_usd >= 0),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS exchange_usage_conversation_created
ON exchange_usage(conversation_id, created_at, id);

CREATE TABLE IF NOT EXISTS overflow_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT NOT NULL,
  context_limit INTEGER NOT NULL CHECK (context_limit > 0),
  local_input_tokens INTEGER NOT NULL CHECK (local_input_tokens >= 0),
  provider_input_tokens INTEGER CHECK (provider_input_tokens >= 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('rejected', 'truncated', 'accepted', 'network_error')),
  http_status INTEGER,
  error_message TEXT,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  cost_micros_usd INTEGER NOT NULL CHECK (cost_micros_usd >= 0),
  created_at TEXT NOT NULL
) STRICT;
```

- [ ] **Step 2: Extend the existing transaction**

Keep `BEGIN IMMEDIATE`. Insert user message, assistant message, capture `assistant_message_id` from `run().lastInsertRowid`, optionally insert usage, update conversation title/timestamp, then `COMMIT`. Any failure executes `ROLLBACK` and preserves the old conversation state.

```ts
saveExchange(
  conversationId: string,
  userContent: string,
  assistantContent: string,
  usage?: ExchangeUsageInput,
): ConversationSummary;
```

Do not create a second transaction or a follow-up usage update.

- [ ] **Step 3: Add query and overflow methods**

```ts
getConversationUsage(conversationId: string): StoredExchangeUsage[];
saveOverflowRun(input: OverflowRunInput): OverflowRun;
getLatestOverflowRun(): OverflowRun | null;
```

Usage rows order by `created_at, id`. Conversation-not-found behavior matches existing store methods. Limit stored `error_message` to 500 Unicode code points before insertion.

- [ ] **Step 4: Add post-implementation persistence tests**

Cover:

- opening a Day 7 database without new rows;
- atomic `user + assistant + usage` insertion;
- a forced usage insert failure rolls back both messages;
- conversation delete cascades into `exchange_usage`;
- `overflow_runs` persists only compact metadata;
- existing no-usage `saveExchange` remains valid for Day 7.

Use temporary databases and close every store.

- [ ] **Step 5: Run store checks**

```bash
npx tsx --test tests/conversation-store.test.ts tests/conversation-usage.test.ts
npm run lint -- src/lib/conversation-store.ts src/lib/conversation-types.ts tests/conversation-store.test.ts tests/conversation-usage.test.ts
npx tsc --noEmit
```

Expected: all old and new SQLite contracts pass.

## Task 6: Add token-aware persistence and analytics endpoints

**Files:**
- Modify: `src/lib/persistent-chat-agent.ts`
- Modify: `src/app/api/conversations/[id]/messages/route.ts`
- Create: `src/lib/token-analytics.ts`
- Create: `src/app/api/conversations/[id]/usage/route.ts`
- Create: `src/app/api/token-experiments/comparison/route.ts`
- Modify: `tests/persistent-chat-agent.test.ts`
- Modify: `tests/conversation-usage.test.ts`

**Interfaces:**
- Consumes token counter, model profile, cost calculator, ChatAgent usage and store methods.
- Produces preflight headers, persisted timeline and comparison DTOs.

- [ ] **Step 1: Add the token-aware response contract**

`PersistentChatAgent.respond()` returns:

```ts
export type PersistentChatResponse = {
  stream: ReadableStream<Uint8Array>;
  preflight: TokenBreakdown;
};
```

Flow:

1. Read history from SQLite.
2. Resolve live model profile.
3. Count prompt with a 4,096-token reserve.
4. Call `assertContextFits` before the provider.
5. Call `ChatAgent.respond`.
6. Forward text and collect the full assistant answer.
7. In clean `flush`, await provider usage.
8. If absent, count assistant text locally.
9. Calculate cost at completion timestamp.
10. Call one `saveExchange(..., usage)` transaction.

Abort or stream error never reaches save.

- [ ] **Step 2: Expose preflight without changing response content**

The messages route returns the same plain-text body and adds integer headers:

```text
X-Token-System
X-Token-History
X-Token-Request
X-Token-Prompt
X-Token-Reserved-Output
X-Token-Context
X-Token-Limit
```

Map `ContextLimitError` to HTTP 422:

```ts
{
  error: "context_limit",
  limit: breakdown.contextLimit,
  system: breakdown.systemTokens,
  history: breakdown.historyTokens,
  request: breakdown.requestTokens,
  reservedOutput: breakdown.reservedOutputTokens,
  total: breakdown.contextTokens,
  overflow: breakdown.contextTokens - breakdown.contextLimit,
}
```

Existing 400/404/500/502 mapping remains. A provider-side context rejection after a
successful local preflight stays an upstream error and is never relabeled as this 422.

- [ ] **Step 3: Build conversation analytics**

`src/lib/token-analytics.ts` exposes:

```ts
export async function getConversationAnalytics(
  store: SqliteConversationStore,
  conversationId: string,
): Promise<ConversationUsageAnalytics>;

export async function getComparisonScenarios(
  store: SqliteConversationStore,
): Promise<TokenComparisonResponse>;
```

For persisted usage, compute cumulative prompt, response and cost using integer addition. For legacy exchanges without usage, reconstruct exchange boundaries from alternating stored roles, count locally and mark `estimated`; do not insert derived rows.

Short fixture: one user/assistant exchange. Long fixture: 20 deterministic exchanges plus the same final user request. Both use the live DeepSeek tokenizer and return local estimates. Add the latest persisted overflow run or `null`.

- [ ] **Step 4: Add thin GET routes**

`GET /api/conversations/:id/usage` returns `{ analytics }`, maps missing conversation to 404 and unexpected failures to 500.

`GET /api/token-experiments/comparison` returns `{ scenarios, latestOverflowRun }`. Neither route reads API keys or calls a provider.

- [ ] **Step 5: Extend post-implementation agent tests**

Assert:

- provider usage wins for prompt/completion totals and cost;
- absent usage uses local response count and `estimated`;
- preflight headers equal the breakdown;
- context overflow prevents the mocked LLM call;
- stream error and abort leave message and usage counts unchanged.

The LLM seam remains injected; tests do not mock SQLite.

- [ ] **Step 6: Verify Stage 2 and commit**

```bash
npx tsx --test tests/chat-agent-usage.test.ts tests/conversation-store.test.ts tests/conversation-usage.test.ts tests/persistent-chat-agent.test.ts
npm run lint -- src/lib/chat-agent.ts src/lib/conversation-types.ts src/lib/conversation-store.ts src/lib/persistent-chat-agent.ts src/lib/token-analytics.ts src/app/api/chat/route.ts 'src/app/api/conversations/[id]/messages/route.ts' 'src/app/api/conversations/[id]/usage/route.ts' src/app/api/token-experiments/comparison/route.ts tests
npx tsc --noEmit
git diff --check
```

Commit:

```bash
git add src/lib src/app/api tests package.json
git commit -m "feat(day-8): persist provider usage"
```

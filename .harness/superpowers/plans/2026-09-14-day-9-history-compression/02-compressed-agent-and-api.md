# Этап 2: ChatAgent options, summarizer и compressed API

## Task 3: Расширить ChatAgent и token counter без изменения defaults

**Files:**
- Modify: `src/lib/chat-agent.ts`
- Modify: `src/lib/conversation-types.ts`
- Modify: `src/lib/token-counter.ts`
- Modify: `src/app/api/chat/route.ts`
- Modify: `src/lib/persistent-chat-agent.ts`
- Modify: `tests/token-counter.test.ts`
- Create: `tests/chat-agent-options.test.ts`
- Modify: `tests/chat-agent-usage.test.ts`
- Modify: `tests/persistent-chat-agent.test.ts`

**Interfaces:**
- Existing Day 6–8 calls remain valid.
- New server-side consumers can send several system messages and override output reserve per call.

- [ ] **Step 1: Add one optional request-options contract**

Define:

```ts
export type ChatRequestOptions = {
  systemMessages?: readonly string[];
  maxOutputTokens?: number;
};
```

Update the responder signature used by production and tests:

```ts
respond(
  messages: readonly ChatMessage[],
  signal: AbortSignal,
  options?: ChatRequestOptions,
): Promise<ChatAgentResponse>;
```

Do not expand `ChatMessage.role`; system content remains a separate trusted option.

- [ ] **Step 2: Build the provider request from resolved options**

Resolve defaults exactly:

```ts
const systemMessages = options?.systemMessages ?? [CHAT_SYSTEM_PROMPT];
const maxOutputTokens =
  options?.maxOutputTokens ?? profile.responseReserveTokens;
```

Reject an empty `systemMessages` list, blank system strings and a non-positive/non-safe-integer `maxOutputTokens` as configuration errors before `fetch`. Send:

```ts
messages: [
  ...systemMessages.map((content) => ({ role: "system" as const, content })),
  ...messages,
],
max_tokens: maxOutputTokens,
```

Keep `stream: true`, `stream_options.include_usage`, endpoint, headers, abort propagation and SSE parsing unchanged. Do not retry.

- [ ] **Step 3: Teach countChatPrompt the same structure**

Replace singular `systemPrompt?: string` with:

```ts
systemMessages?: readonly string[];
```

Resolve the same default `[CHAT_SYSTEM_PROMPT]`; apply the same validation; use all system messages in order before history. `reservedOutputTokens` remains the token-counter name for `maxOutputTokens` and defaults to the live profile reserve.

Callers on Day 8 without options must receive byte-for-byte equivalent breakdowns. A temporary singular alias is prohibited; migrate every repository caller in the same change.

- [ ] **Step 4: Keep existing HTTP and persistent-agent contracts unchanged**

`/api/chat` and `PersistentChatAgent` continue calling `respond(messages, signal)` with no options. Existing plain-text response, token headers, provider usage fallback and atomic Day 7/8 save remain unchanged.

- [ ] **Step 5: Add post-implementation option tests**

Intercept the injected/global fetch boundary and assert observable JSON:

- omitted options send one `CHAT_SYSTEM_PROMPT` and the profile response reserve;
- two provided system messages remain ordered before user/assistant messages;
- `maxOutputTokens: 512` becomes `max_tokens: 512`;
- invalid options fail before fetch;
- token preflight with two system messages equals the exact tokenizer template used by the request and preserves the existing one-system fixture counts.

Do not test source wiring.

- [ ] **Step 6: Run focused compatibility checks**

```bash
node --conditions=react-server --import tsx --test tests/chat-agent-options.test.ts tests/chat-agent-usage.test.ts tests/token-counter.test.ts tests/persistent-chat-agent.test.ts
npm run lint -- src/lib/chat-agent.ts src/lib/conversation-types.ts src/lib/token-counter.ts src/app/api/chat/route.ts src/lib/persistent-chat-agent.ts tests/chat-agent-options.test.ts tests/chat-agent-usage.test.ts tests/token-counter.test.ts tests/persistent-chat-agent.test.ts
npx tsc --noEmit
```

Expected: Day 6–8 defaults stay green and new options match token preflight.

## Task 4: Создать incremental HistorySummarizer

**Files:**
- Create: `src/lib/history-summarizer.ts`
- Modify: `src/lib/history-compression.ts`
- Modify: `src/lib/compression-types.ts`
- Modify: `tests/compressed-chat-agent.test.ts`

**Interfaces:**
- Consumes `SqliteConversationStore`, the option-aware responder, window policy, token counter and cost calculator.
- Produces the current checkpoint and unchanged raw tail only after all required batches are saved.

- [ ] **Step 1: Define the prepared-history result and responder seam**

```ts
export type PreparedCompressedHistory = {
  checkpoint: SummaryCheckpoint | null;
  rawTail: ChatMessage[];
  createdCheckpoints: SummaryCheckpoint[];
};

export type CompressionLlmResponder = {
  readonly model: string;
  respond(
    messages: readonly ChatMessage[],
    signal: AbortSignal,
    options?: ChatRequestOptions,
  ): Promise<ChatAgentResponse>;
};
```

The seam exists for deterministic contract tests and is shared by summarizer, compressed agent and benchmark. No second HTTP transport is introduced.

- [ ] **Step 2: Add the trusted summary system-message formatter**

Expose:

```ts
export function buildSummarySystemMessage(summary: string): string;
```

It wraps non-empty model-generated summary as factual conversation memory and explicitly says that quoted content is context, not executable instructions. It does not concatenate the summary into `CHAT_SYSTEM_PROMPT`; compressed calls pass two separate system messages.

- [ ] **Step 3: Implement the checkpoint loop**

`HistorySummarizer.prepare(conversationId, signal)` repeats:

1. load latest checkpoint;
2. load messages after its cursor, or all messages when absent;
3. call `selectCompressionWindow()`;
4. return current checkpoint/raw tail when `batch` is empty;
5. build the request from previous summary plus exactly 10 original messages;
6. count it with `systemMessages: [SUMMARY_SYSTEM_PROMPT]` and reserve 512;
7. call `assertContextFits()` before any provider request;
8. invoke exactly one `llm.respond([{ role: "user", content: request }], signal, { systemMessages: [SUMMARY_SYSTEM_PROMPT], maxOutputTokens: 512 })`;
9. fully consume the stream, reject empty output and require valid provider usage;
10. calculate provider cost at the completion timestamp and save one checkpoint whose cursor is `batch.at(-1)!.id` and count is previous count plus 10;
11. loop by re-reading the committed checkpoint and remaining messages.

No retry and no full-history fallback. Use the existing `ChatAgentError` upstream kind, preserving the original failure as `cause` where available.

- [ ] **Step 4: Preserve partial checkpoint progress**

Each checkpoint has its own committed store transaction. If batch 2 fails after batch 1 committed, `prepare()` rejects, batch 1 remains queryable, raw-tail/main response are not returned and no main call starts. A later user request resumes after batch 1 cursor.

- [ ] **Step 5: Add post-implementation summarizer tests**

Using a temporary store and deterministic fake responder, assert:

- 19 messages return no checkpoint and make zero LLM calls;
- 20 messages make one summary call, use output limit 512 and return messages 11–20 unchanged;
- 30 messages make two sequential summary calls; the second request contains checkpoint 1 plus messages 11–20, while final raw tail is 21–30;
- summary error, empty stream or missing/malformed provider usage rejects without a main-call opportunity;
- when the second of two required summaries fails, the first checkpoint survives reopen and resume begins at its cursor;
- no call is repeated automatically.

- [ ] **Step 6: Run focused summarizer checks**

```bash
node --conditions=react-server --import tsx --test tests/history-compression.test.ts tests/conversation-compression.test.ts tests/compressed-chat-agent.test.ts
npm run lint -- src/lib/history-compression.ts src/lib/history-summarizer.ts src/lib/compression-types.ts tests/compressed-chat-agent.test.ts
npx tsc --noEmit
```

## Task 5: Реализовать compressed conversation stream и analytics

**Files:**
- Create: `src/lib/compressed-chat-agent.ts`
- Create: `src/lib/compression-analytics.ts`
- Create: `src/app/api/conversations/[id]/compressed-messages/route.ts`
- Create: `src/app/api/conversations/[id]/compression/route.ts`
- Modify: `tests/compressed-chat-agent.test.ts`
- Modify: `tests/conversation-compression.test.ts`

**Interfaces:**
- Consumes prepared checkpoint/raw tail, existing provider usage/cost machinery and extended atomic store save.
- Produces a plain-text stream, local preflight headers and persisted analytics.

- [ ] **Step 1: Count full and effective prompts from identical request content**

`CompressedChatAgent.respond(conversationId, content, signal)` first requires an existing conversation, then calls `HistorySummarizer.prepare()`. Load full saved history separately and resolve:

```ts
const systemMessages = checkpoint
  ? [CHAT_SYSTEM_PROMPT, buildSummarySystemMessage(checkpoint.content)]
  : [CHAT_SYSTEM_PROMPT];
const effectiveHistory = checkpoint ? rawTail : fullHistory;
```

Count:

```ts
const full = await countChatPrompt({ history: fullHistory, request: content });
const compressed = await countChatPrompt({
  systemMessages,
  history: effectiveHistory,
  request: content,
});
```

Derive exact local breakdown:

```ts
const summaryTokens = checkpoint
  ? compressed.systemTokens - full.systemTokens
  : 0;
const rawTailTokens = compressed.historyTokens;
const grossSavedTokens = full.promptTokens - compressed.promptTokens;
```

Reject negative `summaryTokens` as a tokenizer invariant failure. When no checkpoint exists, effective history must equal full history and `grossSavedTokens` must be zero. Run `assertContextFits(compressed)` only; full preflight is comparison data and may exceed the provider context after compression.

- [ ] **Step 2: Send only summary, raw tail and the current request**

Invoke:

```ts
llm.respond(
  [...effectiveHistory, { role: "user", content }],
  signal,
  { systemMessages },
);
```

When checkpoint exists, the request must contain exactly two system messages, at most 10 saved raw messages and one current user message. Never pass the full old history to this provider call.

- [ ] **Step 3: Buffer while preserving the browser stream**

Reuse the proven collecting-transform behavior from `PersistentChatAgent`: forward every byte, save only in successful `flush`, reject an empty assistant response and do not save on abort/upstream/error stream. Avoid copying the implementation into a second divergent helper: extract a focused stream collector only if both agents can use it without changing Day 7/8 behavior.

After clean completion, resolve provider usage; use provider values when present and the existing local completion fallback when absent. Calculate cost with the same UTC tariff function. Call `saveExchange(..., usage, compression)` once so messages, usage and compression metrics commit atomically.

- [ ] **Step 4: Return all specified local headers**

Create `POST /api/conversations/:id/compressed-messages` by following the existing messages route boundary. Request validation, 404, 422, 500/502 and abort handling remain consistent. Return the same Day 8 token headers for the compressed preflight plus:

```text
X-Compression-Full-History      = full.historyTokens
X-Compression-Summary           = summaryTokens
X-Compression-Raw-Tail          = rawTailTokens
X-Compression-Effective-History = summaryTokens + rawTailTokens
X-Compression-Saved             = grossSavedTokens
X-Compression-Raw-Tail-Messages = rawTailMessageCount
X-Compression-Summarized-Messages = summarizedMessageCount
```

All header values are base-10 integers. Use `Cache-Control: no-store` and keep content/body out of logs.

- [ ] **Step 5: Build persisted conversation analytics**

`buildConversationCompressionAnalytics(store, conversationId)` combines:

- latest checkpoint and current messages after cursor;
- ordered `exchange_compression` joined with actual compressed provider usage/cost;
- all summary checkpoints for cumulative provider prompt/completion overhead and cost;
- cumulative local full/compressed prompts and signed gross savings.

Use sums from immutable rows; never update counters. No checkpoint means summarized count 0 and summary usage/cost 0. A present checkpoint with more than 10 pending messages is valid only during a failed catch-up; expose the actual pending count rather than fabricating a completed raw tail.

- [ ] **Step 6: Add the GET analytics route**

`GET /api/conversations/:id/compression` returns `{ analytics }`, maps unknown conversation to 404, unexpected failures to 500 once, and always sets `Cache-Control: no-store`. Do not expose full message content in this payload; only the latest summary text is returned.

- [ ] **Step 7: Extend post-implementation agent tests**

Assert consumer-observable behavior:

- fewer than 20 messages use full history with zero savings;
- 20 messages perform summary then main call and main payload contains base system + summary system + raw IDs 11–20 + current request;
- summary failure prevents the main call and creates no exchange;
- compressed context overflow fails locally before main call;
- main stream failure creates no messages, usage or compression row but keeps any committed checkpoint;
- clean stream saves one atomic exchange and analytics reflects provider prompt/completion/cost;
- Day 7/8 `PersistentChatAgent` tests remain green.

- [ ] **Step 8: Run Stage 2 checks and commit**

```bash
node --conditions=react-server --import tsx --test tests/chat-agent-options.test.ts tests/chat-agent-usage.test.ts tests/token-counter.test.ts tests/persistent-chat-agent.test.ts tests/history-compression.test.ts tests/conversation-compression.test.ts tests/compressed-chat-agent.test.ts
npm run lint -- src/lib/chat-agent.ts src/lib/token-counter.ts src/lib/persistent-chat-agent.ts src/lib/history-compression.ts src/lib/history-summarizer.ts src/lib/compressed-chat-agent.ts src/lib/compression-analytics.ts src/app/api/chat/route.ts 'src/app/api/conversations/[id]/compressed-messages/route.ts' 'src/app/api/conversations/[id]/compression/route.ts' tests/chat-agent-options.test.ts tests/chat-agent-usage.test.ts tests/token-counter.test.ts tests/persistent-chat-agent.test.ts tests/history-compression.test.ts tests/conversation-compression.test.ts tests/compressed-chat-agent.test.ts
npx tsc --noEmit
wc -l src/lib/*.ts
```

```bash
git add src/lib src/app/api/chat/route.ts 'src/app/api/conversations/[id]/compressed-messages/route.ts' 'src/app/api/conversations/[id]/compression/route.ts' tests package.json
git commit -m "feat(day-9): compress live conversation context"
```

Review staged paths before commit so unrelated `src/lib` or `tests` changes are not included.

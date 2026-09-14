# Этап 4: Day 9 interface, real runs и integration gates

## Task 8: Подключить optional compressed route к существующему workspace

**Files:**
- Modify: `src/components/conversation-workspace.tsx`
- Modify: `src/lib/conversation-types.ts`

**Interfaces:**
- Default Day 7/8 workspace behavior stays unchanged.
- Day 9 can select the compressed endpoint and consume response headers without forking chat UI.

- [ ] **Step 1: Add one constrained route prop**

Extend props:

```ts
export type ConversationMessageRoute = "messages" | "compressed-messages";

messageRoute?: ConversationMessageRoute;
```

Default to `"messages"`. Build the existing same-origin path with the selected suffix:

```ts
`/api/conversations/${encodeURIComponent(conversationId)}/${messageRoute}`
```

Do not accept arbitrary URLs and do not change list/create/delete conversation endpoints.

- [ ] **Step 2: Add a raw response-header event**

Extend the existing optional workspace events:

```ts
onResponseHeaders?: (
  conversationId: string,
  headers: Headers,
) => void;
```

Invoke it once after a successful response and before reading the stream. Keep the existing Day 8 token-header parsing and lifecycle events. Day 9 owns compression-header validation; workspace does not learn Day 9 field names.

- [ ] **Step 3: Preserve interaction behavior**

Conversation create/select/delete, empty state, composer shortcuts, abort/error rendering, token badges and existing chat sidebar stay unchanged. A successful compressed stream emits `onExchangeComplete` only after clean completion, so Day 9 refreshes persisted analytics after SQLite commit.

- [ ] **Step 4: Run focused workspace checks**

```bash
npm run lint -- src/components/conversation-workspace.tsx src/lib/conversation-types.ts
npx tsc --noEmit
```

## Task 9: Создать Day 9 analytics и benchmark interface

**Files:**
- Create: `src/components/compression-analytics-panel.tsx`
- Create: `src/components/compression-benchmark-panel.tsx`
- Create: `src/components/day9-workspace.tsx`
- Create: `src/app/day-9/page.tsx`
- Modify: `src/components/site-header.tsx`

**Interfaces:**
- Reuses Flash Chat tokens, typography, responsive shell and interaction patterns from Day 8.
- Day 9 renders no `TokenComparison`, short/long/overflow cards or overflow action.


- [ ] **Step 1: Build CompressionAnalyticsPanel as a pure view**

Props contain persisted `ConversationCompressionAnalytics` plus an optional header-derived `CompressionPreflight` preview while a stream is active. Render:

- full prompt and compressed prompt totals;
- signed gross saved tokens and percentage, preserving negative values;
- summarized message count and actual raw-tail count;
- summary provider prompt + completion overhead and cumulative summary cost;
- actual compressed provider prompt/completion usage and cost;
- a disclosure for the latest summary text and cursor;
- ordered exchange bars labelled `Полная история` and `Summary + хвост`.

For no checkpoint, show the explicit threshold state: full history is still used, summary overhead is zero and savings is zero. Do not display invented zeros when persisted provider usage is unavailable; label those values as unavailable/estimated according to DTO source.

- [ ] **Step 2: Build CompressionBenchmarkPanel**

Render the latest successful run or an empty state. Use the established accessible native `<dialog>` pattern from `TokenComparison` locally: Escape handling, focus restoration and 44×44 px controls. The dialog explains that the operation makes exactly four sequential external LLM calls with no retry. On confirm, POST only `{ "confirmed": true }` to `/api/compression-experiments` and replace the panel with the returned run.

Show:

- full and compressed answers side by side with wrapped preformatted content;
- revealed A/B mapping and winner/tie;
- factual accuracy, completeness, instruction following and overall score for both;
- judge rationale;
- full/compressed provider prompt tokens and signed gross savings;
- summary prompt + completion overhead and net savings;
- cost of summary, full answer, compressed answer and judge separately;
- judge token/cost overhead in a visually separate row excluded from net savings.

Disable repeated submission while running, expose errors near the trigger, maintain focus after close, and never place answer text in a title/attribute.

- [ ] **Step 3: Compose Day9Workspace from the Day 8 shell**

Reuse Day 8 desktop layout proportions and chat composition. По прямому указанию пользователя отдельная mobile adaptation не создаётся: без Day 9 mobile sheet, focus trap и breakpoint-specific controls. На узкой ширине desktop analytics rail скрыт, а чат остаётся работоспособным без горизонтального overflow. Configure:

```tsx
<ConversationWorkspace
  messageRoute="compressed-messages"
  events={{
    onConversationChange,
    onResponseHeaders,
    onExchangeComplete,
  }}
/>
```

Parse all seven `X-Compression-*` headers as signed/non-negative integers according to their fields. Missing/malformed optional headers do not break the chat; clear the preview and let persisted analytics remain authoritative. Refresh `/api/conversations/:id/compression` after conversation selection and clean exchange completion.

Render only `CompressionAnalyticsPanel` and `CompressionBenchmarkPanel` in the analysis area. Never import or render `TokenComparison` from `day9-workspace.tsx`.

- [ ] **Step 4: Create the server page**

`src/app/day-9/page.tsx` follows `/day-8` metadata and server initialization. Load initial conversations/detail, selected conversation compression analytics and latest benchmark run. A new empty database yields valid empty states. Store/configuration failures reach the existing page error boundary; do not fabricate data.

- [ ] **Step 5: Update navigation atomically**

Add `{ href: "/day-9", label: "Day 9" }` to the existing challenge-day list in `site-header.tsx`. Do not remove or rename any earlier route.

- [ ] **Step 6: Apply the established Day 8 visual contract**

Use `ui-ux-pro-max` implementation guidance because Day 9 explicitly extends the existing Day 8 Flash Chat surface. Preserve colors, typography, border radii, density and motion; add no second dashboard theme, gradients or card-inside-card nesting. Ensure:

- desktop analytics remains readable at 1440×900;
- every interactive target is at least 44×44 px;
- `:focus-visible` is present;
- long JSON answers, rationale and summary wrap without horizontal overflow;
- loading/empty/error/disabled states are visible.

- [ ] **Step 7: Run source-level UI checks and commit**

```bash
npm run lint -- src/components/conversation-workspace.tsx src/components/compression-analytics-panel.tsx src/components/compression-benchmark-panel.tsx src/components/day9-workspace.tsx src/components/site-header.tsx src/app/day-9/page.tsx
npx tsc --noEmit
wc -l src/components/*.tsx src/app/day-9/page.tsx
```

```bash
git add src/components/conversation-workspace.tsx src/components/compression-analytics-panel.tsx src/components/compression-benchmark-panel.tsx src/components/day9-workspace.tsx src/components/site-header.tsx src/app/day-9/page.tsx
git commit -m "feat(day-9): visualize context savings"
```

## Task 10: Проверить реальные compressed paths и документацию

**Files:**
- Modify: `README.md`
- Create: `.memory/day-9.md`
- Modify: `.memory/project.md`
- Runtime only: gitignored `data/chat.sqlite`, browser screenshots and temporary HTTP payload files outside repository

**Interfaces:**
- Proves live checkpoint persistence, four-call benchmark, responsive UI and Day 7/8 compatibility.
- Leaves the development server running after build verification.

- [ ] **Step 1: Run the complete focused automated suite**

```bash
npm run test:compression
npm run test:tokens
npm run test:persistence
npm run lint -- src/lib/compression-types.ts src/lib/history-compression.ts src/lib/history-summarizer.ts src/lib/compressed-chat-agent.ts src/lib/compression-analytics.ts src/lib/compression-benchmark.ts src/lib/compression-run-store.ts src/lib/chat-agent.ts src/lib/token-counter.ts src/lib/conversation-store.ts src/lib/conversation-types.ts src/app/api/compression-experiments/route.ts src/app/api/compression-experiments/latest/route.ts 'src/app/api/conversations/[id]/compressed-messages/route.ts' 'src/app/api/conversations/[id]/compression/route.ts' src/components/conversation-workspace.tsx src/components/confirmation-dialog.tsx src/components/token-comparison.tsx src/components/compression-analytics-panel.tsx src/components/compression-benchmark-panel.tsx src/components/day9-workspace.tsx src/components/site-header.tsx src/app/day-9/page.tsx tests/history-compression.test.ts tests/conversation-compression.test.ts tests/chat-agent-options.test.ts tests/compressed-chat-agent.test.ts tests/compression-benchmark.test.ts
npx tsc --noEmit
```

Fix only failures introduced by Day 9 or inside the agreed scope.

- [ ] **Step 2: Start or reuse the established development server**

Use the existing `npm run dev` workflow. Confirm a network URL reachable from the browser. Do not run a production rebuild for source iteration.

- [ ] **Step 3: Exercise a real compressed conversation**

Through the real HTTP/UI path and current `deepseek-v4-flash`:

1. create one dedicated Day 9 conversation;
2. complete 10 short user/assistant exchanges so 20 original messages exist;
3. send the next request through `/compressed-messages`;
4. observe one summary call followed by one main call, with no retries;
5. verify the response, seven compression headers and analytics endpoint;
6. query SQLite and match checkpoint cursor/count/content usage, raw tail, exchange usage and compression row to API/UI.

Never print or persist the API key. Use compact prompts and do not reuse the fixed benchmark transcript in the conversation table.

- [ ] **Step 4: Prove restart persistence**

Stop only the affected Next.js dev process, restart it with the same development command, reopen the Day 9 conversation and verify:

- latest checkpoint/cursor is restored from `data/chat.sqlite`;
- saved full messages remain intact;
- a continuation uses the checkpoint and current raw tail;
- no already summarized batch is summarized again.

Keep the restarted dev server running.

- [ ] **Step 5: Run one real confirmed benchmark**

From the Day 9 confirmation flow, execute exactly one benchmark. Verify the server performed four sequential calls and stored one `compression_runs` row. Match UI and SQLite for summary/full/compressed/judge prompt/completion tokens, each cost, A/B mapping, scores, gross, summary overhead and net savings.

Do not repeat a successful real benchmark merely to improve scores.

- [ ] **Step 6: Verify the desktop surface in a real browser**

At 1440×900:

- open `/day-9`, select the real conversation and inspect analytics/benchmark;
- verify chat, desktop analytics rail, summary disclosure, long JSON wrapping, loading/error-free console and no overflow.

At 390×844 perform only a breakage check required by the repository: the chat remains usable and `scrollWidth <= clientWidth`. Do not add or assess a dedicated mobile analytics composition.

Capture temporary screenshots outside the repository and remove them after inspection.

- [ ] **Step 7: Verify unchanged Day 7 and Day 8**

Open `/day-7` and send/select a conversation through the default full-history route. Open `/day-8` and verify its token analytics plus `TokenComparison` with Short/Long/Overflow cards and overflow button still render. Do not run another real overflow request.

- [ ] **Step 8: Update README and durable project memory**

Document in `README.md`:

- Day 9 route and user-visible behavior;
- immutable 10-message checkpoints plus raw tail 10;
- strict summary failure behavior;
- live compression metrics and fixed four-call blind benchmark;
- `npm run test:compression`.

Create `.memory/day-9.md` with durable architecture, table/API contracts, real observed run IDs/totals and verification notes. Update `.memory/project.md` only where its latest-day summary/navigation is now stale. Never include secrets, full user conversation text or benchmark raw prompts.

Run:

```bash
npm run lint -- README.md
```

If ESLint does not accept Markdown inputs, skip that command and inspect only the edited Markdown diff; do not add a Markdown tool.

```bash
git add README.md .memory/day-9.md .memory/project.md
git commit -m "docs(day-9): document history compression"
```

- [ ] **Step 9: Run final integration gates**

A production build requires stopping the dev server. Stop only that process, then run:

```bash
npm run build
git diff --check
```

Restart `npm run dev`, confirm `/day-9` returns successfully at the reported network URL, and leave it running.

Review uncommitted changes and confirm only gitignored runtime data remains. Do not merge or push `day-9` without a separate user command.

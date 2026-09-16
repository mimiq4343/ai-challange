# Этап 4: интерфейс, документация и полная проверка

## Task 9: Add lifecycle signals to the existing conversation workspace

**Files:**
- Modify: `src/components/conversation-workspace.tsx`
- Modify: `src/lib/conversation-types.ts`

**Interfaces:**
- Preserves all current props and behavior for `/day-7`.
- Produces optional callbacks and token badges consumed only by `Day8Workspace`.

- [ ] **Step 1: Add one optional events object and one presentation prop**

```ts
export type ConversationWorkspaceEvents = {
  onConversationChange?: (conversationId: string | null) => void;
  onUsagePreview?: (conversationId: string, breakdown: TokenBreakdown) => void;
  onExchangeComplete?: (conversationId: string) => void;
};

export type MessageTokenBadge = {
  requestTokens: number;
  responseTokens: number;
  source: "provider" | "estimated";
};
```

Add `events?: ConversationWorkspaceEvents` and
`messageTokenBadges?: readonly MessageTokenBadge[]`. Do not make analytics fetching or
aggregation part of the Day 7 component.

- [ ] **Step 2: Render compact opt-in message badges**

When `messageTokenBadges` exists, match its rows to completed user/assistant exchange
pairs in display order. Show request tokens on the user message and response tokens on
the assistant message, including `provider` or `estimate`. In-progress messages use the
current preview; `/day-7` passes no badges and renders exactly as before.

- [ ] **Step 3: Emit selection changes**

Invoke `onConversationChange` after successful create/select/delete transitions. Keep callback invocation after local state is committed so consumers cannot observe an ID that the workspace rejected.

- [ ] **Step 4: Read preflight response headers**

After the messages fetch resolves and before reading the stream, parse the seven `X-Token-*` headers. If all are valid non-negative integers, emit `onUsagePreview`. Missing or malformed optional headers do not break Day 7 chat.

- [ ] **Step 5: Emit completion only after clean stream completion**

Call `onExchangeComplete` after the final text chunk and successful reader completion. Abort and error paths do not emit it.

- [ ] **Step 6: Run the existing component checks**

```bash
npm run lint -- src/components/conversation-workspace.tsx src/lib/conversation-types.ts
npx tsc --noEmit
```

Expected: `/day-7` requires no call-site change.

## Task 10: Build the Day 8 analytics surface

**Files:**
- Create: `src/components/token-analytics-panel.tsx`
- Create: `src/components/token-comparison.tsx`
- Create: `src/components/day8-workspace.tsx`
- Create: `src/app/day-8/page.tsx`
- Modify: existing route/navigation entry points discovered beside `/day-7`

**Interfaces:**
- Consumes conversation usage, comparison and overflow APIs.
- Owns Day 8-only fetch state; composes existing `ConversationWorkspace` without duplicating chat logic.

- [ ] **Step 1: Build the analytics panel as a pure view**

Props:

```ts
type TokenAnalyticsPanelProps = {
  analytics: ConversationUsageAnalytics | null;
  preview: TokenBreakdown | null;
  loading: boolean;
  error: string | null;
};
```

Render:

- current prompt tokens and percentage of 1,000,000;
- reserved output 4,096;
- cumulative response tokens;
- cumulative micro-USD formatted as dollars with at least six decimals;
- source badge `provider` or `estimate`; request/history segment legend always says `estimate`, even when provider totals exist;
- horizontal stacked bars for system/history/current request/response per exchange;
- empty, loading and error states.

Use semantic text plus SVG/CSS; no chart dependency. Do not rely on color alone: each segment has a text label or accessible legend.

- [ ] **Step 2: Build comparison and experiment controls**

`TokenComparison` renders three deliberately different columns:

1. `Короткий` — one exchange and low context use.
2. `Длинный` — deterministic multi-exchange estimate.
3. `Переполнение` — latest real provider run or an explicit not-run state.

Every column exposes request, history, response, total/context usage, cost and result.
Unavailable provider fields render as `Нет данных`, never as zero.

The overflow button opens an accessible confirmation dialog. Dialog includes model, endpoint purpose, 32,768 limit, 33,280 target, zero price and no retry. Buttons are `Отмена` and `Запустить 1 запрос`; Escape closes; focus returns to trigger.

On confirm:

```ts
fetch("/api/token-experiments/overflow", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ confirmed: true }),
});
```

Disable duplicate submission while pending. Render the actual outcome without translating it into a preferred result.

- [ ] **Step 3: Compose Day8Workspace**

State ownership:

```ts
activeConversationId
analytics
preview
comparison
loadingAnalytics
runningOverflow
error
```

Use `ConversationWorkspaceEvents` to update active ID, show preflight immediately and refetch persisted analytics after clean completion. Derive `messageTokenBadges` from the ordered analytics exchanges and pass them back into `ConversationWorkspace`; append the preview only for the active in-flight exchange. Abort stale usage fetches when selection changes. Do not retry failed requests automatically.

Desktop layout: sidebar + chat + analytics rail. Comparison sits below/within analytics without shrinking the chat input below usable width. Mobile layout: existing sidebar drawer plus analytics bottom sheet triggered by a 44×44 control. The sheet must not create horizontal page overflow.

- [ ] **Step 4: Create the server page**

`src/app/day-8/page.tsx` follows `/day-7` metadata and server initialization. Load initial conversations/detail plus initial usage and comparison. A missing optional analytics row yields the empty state; database or tokenizer failure reaches the existing page error boundary rather than fabricated data.

- [ ] **Step 5: Update navigation atomically**

Add `/day-8` wherever challenge days are enumerated: landing page, previous/next controls and shared nav if present. Do not alter `/day-6` or `/day-7` route behavior. Remove no legacy route.

- [ ] **Step 6: Apply the selected UI skill constraints**

Use `ui-ux-pro-max` before implementation. Preserve Flash Chat tokens, typography, glass/gradient treatment and motion language; avoid a separate dashboard theme. Verify:

- focus rings visible on all controls;
- 44×44 minimum targets;
- live status uses `aria-live="polite"`;
- dialog has accessible name and focus trap;
- reduced motion removes nonessential transitions;
- chart text remains readable in both desktop and mobile widths.

- [ ] **Step 7: Run source-level UI checks**

```bash
npm run lint -- src/components/conversation-workspace.tsx src/components/day8-workspace.tsx src/components/token-analytics-panel.tsx src/components/token-comparison.tsx src/app/day-8/page.tsx
npx tsc --noEmit
```

Expected: no lint/type failures; every source file remains below 800 lines.

- [ ] **Step 8: Commit the interface**

```bash
git add src/components src/app/day-8 src/app/page.tsx
# Add other existing navigation files only if modified.
git commit -m "feat(day-8): visualize token growth"
```

## Task 11: Verify short, long and restarted conversations

**Files:**
- Runtime only: gitignored `data/chat.sqlite`

**Interfaces:**
- Uses the actual browser surface and configured DeepSeek endpoint.
- Produces visible evidence, not permanent test fixtures.

- [ ] **Step 1: Start the established dev server**

```bash
npm run dev
```

Wait for readiness and use the actual `/day-8` route.

- [ ] **Step 2: Exercise a short conversation**

Create a new conversation, send one short prompt and wait for completion. Verify:

- response streams normally;
- preflight appears before persistence refresh;
- final source changes to provider when provider usage exists;
- prompt = system + history + current request;
- cumulative cost is non-negative;
- SQLite has two messages and one `exchange_usage` row.

- [ ] **Step 3: Exercise a genuinely long conversation**

Use one conversation with enough substantive turns to make `historyTokens` visibly dominate `requestTokens`. Verify every completed turn creates exactly one usage row and context growth is monotonic except for any provider cache accounting display, which is separate from local prompt growth.

- [ ] **Step 4: Verify full restart persistence**

Stop the dev server completely, start it again, reopen `/day-8` and select both conversations. Verify messages, provider usage, cumulative totals and latest overflow result survive. Then send one more turn and verify history tokens include the restored transcript.

- [ ] **Step 5: Exercise failure and abort paths**

Abort one in-flight message by navigating/selecting away according to existing behavior. Verify no partial assistant message or usage row was saved. Trigger a client validation error and verify analytics remains unchanged.

- [ ] **Step 6: Smoke-test the preserved Day 6 and Day 7 surfaces**

Open `/day-6`, send one prompt and verify the plain-text stream still renders without
analytics. Open `/day-7`, select an existing conversation, send one prompt and verify
persistence remains intact without Day 8 panels or badges.

## Task 12: Run the real overflow experiment and visual verification

**Files:**
- Runtime only: gitignored `data/chat.sqlite`

- [ ] **Step 1: Run exactly one confirmed overflow request**

Open `/day-8`, click `Запустить реальный overflow-тест`, verify the confirmation names model `nvidia/nemotron-3-embed-1b:free`, limit 32,768, target 33,280, cost $0 and one request without retry, then confirm once. If local configuration is missing, stop before fetch and ask the user to set `OPENROUTER_API_KEY` in `.env.local`; never substitute a key or fake result. Verify the UI and newest `overflow_runs` row agree on outcome, HTTP status, local/provider counts, duration and zero cost, and that the table contains no generated input or embedding vector.

- [ ] **Step 2: Verify desktop presentation**

At 1440×900, inspect sidebar, chat, analytics rail, comparison, dialog, running state and completed result. Confirm no clipped content, overlapping controls or horizontal viewport overflow.

- [ ] **Step 3: Verify mobile presentation**

At 390×844, inspect sidebar drawer, chat input, analytics trigger, bottom sheet, comparison and dialog. Use keyboard navigation for focus order and Escape. Confirm all controls remain at least 44×44 px and document width equals viewport width.

- [ ] **Step 4: Verify accessibility state changes**

Check loading, error, empty, estimate, provider and all four overflow outcomes are distinguishable in markup and not only by color. Use browser evaluation to confirm dialog role/name and `aria-live` status.

## Task 13: Document behavior and run final gates

**Files:**
- Modify: `README.md`
- Create: `.harness/memory/day-8.md`
- Modify: `.harness/memory/project.md`

- [ ] **Step 1: Update README**

Document:

- `/day-8` route and user flow;
- hybrid local/provider counting;
- provider usage precedence;
- 4,096-token output reserve;
- SQLite usage persistence;
- local tokenizer assets and their provenance manifest;
- `OPENROUTER_API_KEY` setup without a value;
- real overflow experiment warning, model, 32,768 limit, 33,280 target and zero price;
- test commands.

Do not claim a specific overflow outcome until the real run has produced it.

- [ ] **Step 2: Record durable project memory**

`.harness/memory/day-8.md` records architecture, schema, model IDs, context limits, pricing timestamp, observed overflow outcome and verification facts. Update `.harness/memory/project.md` route/feature index. Never record credentials or generated oversized input.

- [ ] **Step 3: Run the complete targeted suite**

```bash
npm run test:tokens
npm run test:persistence
npm run lint
npx tsc --noEmit
npm run build
git diff --check
git status --short
```

Expected: all commands pass. Build must not attempt remote tokenizer/model downloads.

- [ ] **Step 4: Review uncommitted changes**

Confirm only Day 8 implementation, tokenizer assets, docs and intended lockfile changes are present. Remove temporary screenshots/downloads. Keep `data/chat.sqlite`, WAL/SHM and `.env.local` untracked.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md .harness/memory/day-8.md .harness/memory/project.md
git commit -m "docs(day-8): document token behavior"
```

If implementation corrections remain after final gates, amend the owning feature commit only when safe; otherwise create a focused conventional commit. Do not push or merge.

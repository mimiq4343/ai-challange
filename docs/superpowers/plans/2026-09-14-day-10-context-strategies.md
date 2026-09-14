# Day 10 Context Strategies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить `/day-10` с persistent Sliding Window, Sticky Facts, Branching и единым сравнением.

**Architecture:** Отдельный `SqliteContextStrategyStore` хранит Day 10 state в `data/chat.sqlite`. `ContextStrategyAgent` подготавливает strategy-specific context и вызывает существующий `ChatAgent`; отдельный benchmark и workspace не меняют Day 7–9.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, built-in `node:sqlite`.

**Spec:** `docs/superpowers/specs/2026-09-14-day-10-context-strategies-design.md`

## Global Constraints

- Summary и таблицы Day 9 не используются.
- Sliding/Facts window содержит 6 сообщений.
- Day 7–9 и `/api/chat` сохраняют поведение.
- Новые source-файлы меньше 800 строк.
- Benchmark не retry-ит LLM-вызовы и не использует judge.

---

### Task 1: Contracts, policy and SQLite store

**Files:**
- Create: `src/lib/context-strategy-types.ts`
- Create: `src/lib/context-strategy-policy.ts`
- Create: `src/lib/context-strategy-store.ts`
- Test: `tests/context-strategy-store.test.ts`

**Interfaces:**
- Produces: `ContextStrategy`, `StickyFacts`, `ContextSession`, `ContextBranch`, `ContextStrategyStore`.
- Produces: `WINDOW_MESSAGES = 6`, `parseStickyFacts(text)`, `buildFactsSystemMessage(facts)`.

- [ ] **Step 1: Write store/policy tests**

```ts
test("sliding keeps only six messages", () => {
  // save four completed exchanges and assert six retained rows
});

test("branches share checkpoint but isolate continuations", () => {
  // create checkpoint, write distinct branch messages, assert no sibling rows
});

test("facts parser rejects extra keys", () => {
  assert.throws(() => parseStickyFacts('{"goal":"x","extra":true}'));
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `node --conditions=react-server --import tsx --test tests/context-strategy-store.test.ts`
Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement contracts, strict parser and store**

```ts
export type ContextStrategy = "sliding" | "facts" | "branching";
export type StickyFacts = {
  goal: string;
  constraints: string[];
  preferences: string[];
  decisions: string[];
  agreements: string[];
};
export const WINDOW_MESSAGES = 6;
```

The store creates `context_sessions`, `context_messages`, `context_checkpoints`,
`context_branches`, and `context_benchmark_runs`; uses transactions for exchanges,
facts updates, pruning, checkpoint creation and branch activation.

- [ ] **Step 4: Run tests and verify pass**

Run: `node --conditions=react-server --import tsx --test tests/context-strategy-store.test.ts`
Expected: PASS.

---

### Task 2: Strategy agent and session APIs

**Files:**
- Create: `src/lib/context-strategy-agent.ts`
- Create: `src/app/api/context-strategies/sessions/route.ts`
- Create: `src/app/api/context-strategies/sessions/[id]/route.ts`
- Create: `src/app/api/context-strategies/sessions/[id]/messages/route.ts`
- Create: `src/app/api/context-strategies/sessions/[id]/checkpoint/route.ts`
- Create: `src/app/api/context-strategies/sessions/[id]/branches/[branchId]/activate/route.ts`
- Test: `tests/context-strategy-agent.test.ts`

**Interfaces:**
- Consumes: Task 1 types/store/policy.
- Produces: `ContextStrategyAgent.respond(sessionId, content, signal)` and route JSON contracts.

- [ ] **Step 1: Write focused agent tests**

```ts
test("facts extractor runs before main response and its system block is sent", async () => {
  // fake two LLM calls; assert strict facts update then facts + six-message prompt
});

test("branch prompt excludes sibling branch messages", async () => {
  // capture LLM messages and assert sibling content absent
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `node --conditions=react-server --import tsx --test tests/context-strategy-agent.test.ts`
Expected: FAIL because agent does not exist.

- [ ] **Step 3: Implement agent and routes**

Facts extraction uses `ChatAgent.respond()` with a strict JSON system prompt and no
retry. A failed extractor/main stream does not persist a partial exchange. Sliding
prunes only after completed exchange. Branching requires an active branch after a
checkpoint.

- [ ] **Step 4: Run tests and verify pass**

Run: `node --conditions=react-server --import tsx --test tests/context-strategy-agent.test.ts`
Expected: PASS.

---

### Task 3: Deterministic benchmark

**Files:**
- Create: `src/lib/context-strategy-benchmark.ts`
- Create: `src/app/api/context-strategies/benchmark/route.ts`
- Create: `src/app/api/context-strategies/benchmark/latest/route.ts`
- Test: `tests/context-strategy-benchmark.test.ts`

**Interfaces:**
- Consumes: Task 1 store/types and existing `CompressionLlmResponder`-compatible response interface.
- Produces: `ContextStrategyBenchmark.run()` with three outputs, provider usage, quality/stability and UX notes.

- [ ] **Step 1: Write benchmark test**

```ts
test("runs one fixed scenario for all strategies and saves comparable metrics", async () => {
  // scripted LLM output; assert strategy order, required-fact scores and provider totals
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `node --conditions=react-server --import tsx --test tests/context-strategy-benchmark.test.ts`
Expected: FAIL because benchmark does not exist.

- [ ] **Step 3: Implement benchmark**

Use a 12-message ТЗ fixture. Shape three contexts without summary; perform one final
response per strategy plus facts extraction, score known required values by normalized
substring match, and save only a wholly successful run. No judge and no retry.

- [ ] **Step 4: Run test and verify pass**

Run: `node --conditions=react-server --import tsx --test tests/context-strategy-benchmark.test.ts`
Expected: PASS.

---

### Task 4: Day 10 workspace

**Files:**
- Create: `src/app/day-10/page.tsx`
- Create: `src/components/day10-workspace.tsx`
- Create: `src/components/context-strategy-panel.tsx`
- Create: `src/components/context-benchmark-panel.tsx`
- Modify: `src/components/site-header.tsx`

**Interfaces:**
- Consumes: session, branch and benchmark API contracts from Tasks 2–3.
- Produces: `/day-10` strategy switch, chat, facts/window inspector, branch controls and comparison.

- [ ] **Step 1: Implement server page and client workspace**

Use existing Flash Chat classes/components. Strategy switch creates/selects one session
per strategy. Branching exposes checkpoint, `Ветка A`, `Ветка B` and active branch.
Streaming messages use the existing NDJSON/SSE reader pattern.

- [ ] **Step 2: Implement comparison panel**

Show output, quality, stability, provider tokens/cost and UX note for all strategies.
No Day 9 summary controls are rendered.

- [ ] **Step 3: Run targeted static checks**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npm run lint -- src/app/day-10/page.tsx src/components/day10-workspace.tsx src/components/context-strategy-panel.tsx src/components/context-benchmark-panel.tsx src/components/site-header.tsx`
Expected: exit 0.

---

### Task 5: Documentation and end-to-end verification

**Files:**
- Modify: `README.md`
- Modify: `.memory/project.md`
- Create: `.memory/day-10.md`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run test:context-strategies` and durable Day 10 documentation.

- [ ] **Step 1: Add focused test script and docs**

```json
"test:context-strategies": "node --conditions=react-server --import tsx --test tests/context-strategy-store.test.ts tests/context-strategy-agent.test.ts tests/context-strategy-benchmark.test.ts"
```

- [ ] **Step 2: Run focused and regression checks**

Run: `npm run test:context-strategies`
Expected: all tests pass.

Run: `npm run test:persistence && npm run test:compression && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 3: Run one real benchmark and browser smoke**

POST `/api/context-strategies/benchmark` once. Open `/day-10` at desktop and 390 px;
verify switching, checkpoint creation, both branch tabs and no horizontal overflow.

- [ ] **Step 4: Run integration gates**

Run: `npm run build && git diff --check`
Expected: build succeeds and diff check is empty.

- [ ] **Step 5: Commit implementation**

```bash
git add .memory README.md package.json src tests docs/superpowers/plans/2026-09-14-day-10-context-strategies.md
git commit -m "feat(day-10): add context management strategies"
```

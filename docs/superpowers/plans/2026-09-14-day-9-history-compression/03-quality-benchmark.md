# Этап 3: фиксированный quality benchmark и blind judge

## Task 6: Реализовать четырёхвызовный benchmark

**Files:**
- Modify: `src/lib/compression-types.ts`
- Create: `src/lib/compression-benchmark.ts`
- Create: `tests/compression-benchmark.test.ts`

**Interfaces:**
- Consumes the option-aware `CompressionLlmResponder`, existing summary formatter, tokenizer and DeepSeek cost calculator.
- Produces one validated `CompressionRunInput` only after four successful sequential provider calls.

- [ ] **Step 1: Define a fixed 20-message benchmark in code**

Export immutable server-only fixtures from `compression-benchmark.ts`:

```ts
export const BENCHMARK_HISTORY = [
  { role: "user", content: "Кодовое имя проекта — Аврора." },
  { role: "assistant", content: "Запомнил кодовое имя: Аврора." },
  { role: "user", content: "Дата запуска — 15 мая." },
  { role: "assistant", content: "Запомнил дату запуска: 15 мая." },
  { role: "user", content: "Основной склад находится в Казани." },
  { role: "assistant", content: "Запомнил склад: Казань." },
  { role: "user", content: "Бюджет пилота — 2,4 млн рублей." },
  { role: "assistant", content: "Запомнил бюджет: 2,4 млн рублей." },
  { role: "user", content: "Руководитель проекта — Марина Волкова." },
  { role: "assistant", content: "Запомнил руководителя: Марина Волкова." },
  { role: "user", content: "Доставка выполняется железной дорогой." },
  { role: "assistant", content: "Запомнил способ доставки: железная дорога." },
  { role: "user", content: "Поставщик упаковки — Орион." },
  { role: "assistant", content: "Запомнил поставщика: Орион." },
  { role: "user", content: "Пилотная партия содержит 320 единиц." },
  { role: "assistant", content: "Запомнил объём: 320 единиц." },
  { role: "user", content: "Цвет маркировки — синий." },
  { role: "assistant", content: "Запомнил цвет маркировки: синий." },
  { role: "user", content: "Отчётность ведётся в рублях." },
  { role: "assistant", content: "Запомнил валюту отчётности: рубли." },
] as const satisfies readonly ChatMessage[];
```

Define a fixed final question that requires one JSON object with all ten named facts and no prose. Define the reference answer separately for the judge rubric. Client request cannot alter history, question, model or rubric.

- [ ] **Step 2: Define run and judge contracts**

```ts
export type BenchmarkCallMetrics = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costMicrosUsd: number;
};

export type JudgeScores = {
  factualAccuracy: number;
  completeness: number;
  instructionFollowing: number;
  overall: number;
};

export type BlindJudgeResult = {
  a: JudgeScores;
  b: JudgeScores;
  winner: "a" | "b" | "tie";
  rationale: string;
};

export type CompressionRunInput = {
  model: string;
  summary: string;
  fullAnswer: string;
  compressedAnswer: string;
  labelA: "full" | "compressed";
  judge: BlindJudgeResult;
  calls: {
    summary: BenchmarkCallMetrics;
    full: BenchmarkCallMetrics;
    compressed: BenchmarkCallMetrics;
    judge: BenchmarkCallMetrics;
  };
  grossSavedTokens: number;
  summaryOverheadTokens: number;
  netSavedTokens: number;
};

export type CompressionRun = CompressionRunInput & {
  id: number;
  createdAt: string;
};
```

All provider token counts/costs are non-negative safe integers. Savings are signed integers.

- [ ] **Step 3: Add one strict server-side response consumer**

Create a helper that fully reads a `ChatAgentResponse`, rejects an empty text result and requires provider usage. It calculates cost from provider prompt/completion/cache fields at an injected `now()` timestamp and returns `{ text, usage, metrics }`.

Summary, both answer calls and judge all use this helper. Missing/malformed usage is a benchmark failure because provider usage is the source of truth. Do not estimate benchmark totals and do not retry.

- [ ] **Step 4: Execute exactly four calls in sequence**

`CompressionBenchmark.run(signal)` must `await` these calls one after another:

1. **Summary:** first 10 messages, `SUMMARY_SYSTEM_PROMPT`, `maxOutputTokens: 512`.
2. **Full answer:** all 20 messages plus fixed question, default `CHAT_SYSTEM_PROMPT` and default response reserve.
3. **Compressed answer:** summary system message, messages 11–20 plus the same question.
4. **Blind judge:** judge system prompt plus one user payload containing reference facts, rubric, original question, answer A and answer B.

Do not use `Promise.all`. Verify local preflight and `assertContextFits()` before each call. The summary request uses the same `buildSummaryRequest(null, firstTen)` function as live compression.

- [ ] **Step 5: Randomize answer labels before constructing judge input**

Inject a `randomBit(): 0 | 1` seam whose production default uses `node:crypto`. When 0, A=full/B=compressed; when 1, A=compressed/B=full. Build judge payload only after this mapping. It must not contain the words `full`, `compressed`, token counts, cost, call order or implementation labels.

The returned/persisted `labelA` records the mapping after judging so the UI can reveal which version won. The model sees only A/B.

- [ ] **Step 6: Require strict judge JSON**

Judge system prompt requests exactly:

```json
{
  "a": {
    "factualAccuracy": 0,
    "completeness": 0,
    "instructionFollowing": 0,
    "overall": 0
  },
  "b": {
    "factualAccuracy": 0,
    "completeness": 0,
    "instructionFollowing": 0,
    "overall": 0
  },
  "winner": "a",
  "rationale": "Краткое объяснение"
}
```

`parseBlindJudgeResult(text)` accepts one JSON object only: no Markdown fences, trailing prose, missing keys or extra top-level/score keys. Each score must be an integer in `[0, 10]`; winner is `a | b | tie`; rationale is non-empty after trim and capped at 1,000 Unicode code points. Invalid output throws and no run is persisted. Never fabricate or repair judge output.

- [ ] **Step 7: Calculate operational savings from provider usage**

After the judge succeeds:

```ts
const grossSavedTokens =
  full.metrics.promptTokens - compressed.metrics.promptTokens;
const summaryOverheadTokens =
  summary.metrics.promptTokens + summary.metrics.completionTokens;
const netSavedTokens = grossSavedTokens - summaryOverheadTokens;
```

Judge prompt/completion tokens and cost remain visible under `calls.judge` but do not affect `netSavedTokens`. Preserve negative gross/net values.

- [ ] **Step 8: Add post-implementation service tests**

Fake responder calls record messages/options and return unique valid usage. Assert:

- exactly four calls, in summary/full/compressed/judge order;
- no retry after any one of the four calls rejects;
- summary sees messages 1–10; full sees all 20; compressed sees summary plus messages 11–20;
- full and compressed use the identical fixed final question;
- both random branches hide implementation labels from judge input and map the winner correctly;
- strict parser rejects fences, decimals, out-of-range scores, missing/extra keys and invalid winner;
- gross, overhead and net use provider counts and exclude judge;
- missing usage or malformed judge produces no successful result.

## Task 7: Сохранить и открыть последний успешный benchmark

**Files:**
- Create: `src/lib/compression-run-store.ts`
- Create: `src/app/api/compression-experiments/route.ts`
- Create: `src/app/api/compression-experiments/latest/route.ts`
- Modify: `tests/compression-benchmark.test.ts`

**Interfaces:**
- Consumes validated `CompressionRunInput`.
- Produces append-only successful runs and thin no-store API routes.

- [ ] **Step 1: Create a focused benchmark store**

`SqliteCompressionRunStore` accepts an explicit database path for tests and has a global factory pointing to the same `data/chat.sqlite` as `getConversationStore()`. It opens SQLite with `foreign_keys = ON`, `journal_mode = WAL`, a 5-second busy timeout and creates only its owned table.

Use additive STRICT DDL with explicit columns:

```sql
CREATE TABLE IF NOT EXISTS compression_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT NOT NULL,
  summary TEXT NOT NULL CHECK (length(summary) > 0),
  full_answer TEXT NOT NULL CHECK (length(full_answer) > 0),
  compressed_answer TEXT NOT NULL CHECK (length(compressed_answer) > 0),
  label_a TEXT NOT NULL CHECK (label_a IN ('full', 'compressed')),
  judge_json TEXT NOT NULL CHECK (json_valid(judge_json)),
  summary_prompt_tokens INTEGER NOT NULL CHECK (summary_prompt_tokens >= 0),
  summary_completion_tokens INTEGER NOT NULL CHECK (summary_completion_tokens >= 0),
  summary_cost_micros_usd INTEGER NOT NULL CHECK (summary_cost_micros_usd >= 0),
  full_prompt_tokens INTEGER NOT NULL CHECK (full_prompt_tokens >= 0),
  full_completion_tokens INTEGER NOT NULL CHECK (full_completion_tokens >= 0),
  full_cost_micros_usd INTEGER NOT NULL CHECK (full_cost_micros_usd >= 0),
  compressed_prompt_tokens INTEGER NOT NULL CHECK (compressed_prompt_tokens >= 0),
  compressed_completion_tokens INTEGER NOT NULL CHECK (compressed_completion_tokens >= 0),
  compressed_cost_micros_usd INTEGER NOT NULL CHECK (compressed_cost_micros_usd >= 0),
  judge_prompt_tokens INTEGER NOT NULL CHECK (judge_prompt_tokens >= 0),
  judge_completion_tokens INTEGER NOT NULL CHECK (judge_completion_tokens >= 0),
  judge_cost_micros_usd INTEGER NOT NULL CHECK (judge_cost_micros_usd >= 0),
  gross_saved_tokens INTEGER NOT NULL,
  summary_overhead_tokens INTEGER NOT NULL CHECK (summary_overhead_tokens >= 0),
  net_saved_tokens INTEGER NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
```

`totalTokens` is derived as prompt + completion when mapping; do not persist a denormalized duplicate. `judge_json` comes only from the already validated typed object and is validated again when read.

- [ ] **Step 2: Add append/read methods**

```ts
saveRun(input: CompressionRunInput): CompressionRun;
getLatestRun(): CompressionRun | null;
close(): void;
```

Insert one row in one statement. Latest orders by `created_at DESC, id DESC`. Parse `judge_json` through `parseBlindJudgeResult`; malformed persisted data is an invariant error, not an empty state. Do not persist the 20-message fixture or judge raw response.

- [ ] **Step 3: Persist only after all four calls and validation**

Inject the run store into `CompressionBenchmark`. Call `saveRun()` only after call 4 completes, usage is valid, judge JSON is valid and savings are calculated. Failures at calls 1–4 leave `compression_runs` unchanged.

- [ ] **Step 4: Add confirmed POST route**

`POST /api/compression-experiments` accepts only a JSON object with `confirmed === true`. Invalid JSON or missing confirmation returns 400. The client cannot supply any other benchmark inputs. Instantiate environment ChatAgent, stores and service server-side; return `{ run }` on success.

Map configuration failures to 500, provider/judge failures to 502 and abort by rethrowing. Log unexpected errors once at this boundary with no prompts, answers, summary, API key or provider body.

- [ ] **Step 5: Add no-store latest route**

`GET /api/compression-experiments/latest` returns `{ run: CompressionRun | null }` with `Cache-Control: no-store`. Unexpected store errors return generic 500 and are logged once without persisted content.

- [ ] **Step 6: Extend post-implementation persistence/API tests**

Use a temporary SQLite file and assert:

- a valid run survives close/reopen with all four usage/cost groups and signed savings;
- latest picks the higher timestamp/id;
- no fixture transcript is stored;
- strict judge validation also guards reads;
- service failure at each call and malformed judge leave row count unchanged;
- confirmed body validation is covered through the exported route handler only if dependencies can be injected without production-only branches; otherwise verify the thin route through the real HTTP smoke in Stage 4.

- [ ] **Step 7: Run Stage 3 checks and commit**

```bash
node --conditions=react-server --import tsx --test tests/compression-benchmark.test.ts tests/chat-agent-options.test.ts tests/history-compression.test.ts
npm run lint -- src/lib/compression-types.ts src/lib/compression-benchmark.ts src/lib/compression-run-store.ts src/app/api/compression-experiments/route.ts src/app/api/compression-experiments/latest/route.ts tests/compression-benchmark.test.ts
npx tsc --noEmit
wc -l src/lib/compression-benchmark.ts src/lib/compression-run-store.ts src/lib/compression-types.ts
```

```bash
git add src/lib/compression-types.ts src/lib/compression-benchmark.ts src/lib/compression-run-store.ts src/app/api/compression-experiments tests/compression-benchmark.test.ts
git commit -m "feat(day-9): compare compressed response quality"
```

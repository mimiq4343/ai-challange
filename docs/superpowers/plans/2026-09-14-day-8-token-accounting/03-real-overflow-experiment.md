# Этап 3: реальный OpenRouter overflow experiment

## Task 7: Реализовать один внешний embeddings-запрос сверх лимита

**Files:**
- Create: `src/lib/overflow-experiment.ts`
- Create: `tests/overflow-experiment.test.ts`

**Interfaces:**
- Consumes `buildOverflowInput()`, `NEMOTRON_OVERFLOW_PROFILE` and overflow store methods.
- Produces `OverflowExperimentService.run({ confirmed, signal })` and outcome classification.

- [ ] **Step 1: Define the external response boundary**

```ts
export type OverflowFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class OverflowExperimentError extends Error {
  constructor(
    message: string,
    readonly kind: "configuration" | "validation" | "network",
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
```

The service receives `store`, `fetchImpl = fetch`, and an env object. It requires `confirmed === true`; otherwise throw validation before tokenizer work.

- [ ] **Step 2: Fail fast on missing OpenRouter configuration**

Read only `OPENROUTER_API_KEY`. Missing or blank means explicit configuration error:

```text
Не задан OPENROUTER_API_KEY для реального overflow-теста.
```

Never include the key, Authorization header or input text in errors and logs.

- [ ] **Step 3: Generate and send the measured oversized input**

Call `buildOverflowInput(33_280)` and assert `tokens > 32_768` immediately before fetch. Execute exactly one request:

```ts
await fetchImpl("https://openrouter.ai/api/v1/embeddings", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "nvidia/nemotron-3-embed-1b:free",
    input: oversized.text,
  }),
  signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
});
```

No retry. Do not calculate or log body length by serializing it a second time.

- [ ] **Step 4: Parse only compact response metadata**

For successful responses, parse:

```ts
type EmbeddingResponse = {
  data?: Array<{ embedding?: unknown }>;
  usage?: { prompt_tokens?: unknown; total_tokens?: unknown };
};
```

Discard `data` immediately. Validate provider token counts as non-negative integers. On non-2xx, read at most the bounded JSON/text response and sanitize to 500 Unicode code points.

- [ ] **Step 5: Classify the observed outcome**

Use one pure function:

```ts
export function classifyOverflowResult(input: {
  ok: boolean;
  localInputTokens: number;
  providerInputTokens: number | null;
  contextLimit: number;
}): "rejected" | "truncated" | "accepted";
```

Rules:

```ts
if (!ok) return "rejected";
if (providerInputTokens !== null && providerInputTokens < localInputTokens) return "truncated";
return "accepted";
```

Transport failure or timeout maps to `network_error`, not `rejected`. Persist the compact run before returning it. Cost is always zero for this profile.

- [ ] **Step 6: Add post-implementation tests**

Inject deterministic fetch responses and assert:

- `confirmed: false` performs zero fetch calls;
- missing key performs zero fetch calls;
- 400 context response becomes `rejected` with bounded error;
- successful usage below local count becomes `truncated`;
- successful usage equal/above local count becomes `accepted`;
- thrown fetch and timeout become `network_error`;
- each run performs exactly one fetch;
- persisted row contains no input or embedding field.

The test key is a literal fake value scoped to the test process.

## Task 8: Expose the confirmed experiment endpoint

**Files:**
- Create: `src/app/api/token-experiments/overflow/route.ts`
- Modify: `src/lib/overflow-experiment.ts`
- Modify: `tests/overflow-experiment.test.ts`

**Interfaces:**
- Produces `POST /api/token-experiments/overflow` accepting `{ confirmed: true }`.
- Returns `{ run: OverflowRun }`; never streams or returns embedding data.

- [ ] **Step 1: Validate the request body at the HTTP boundary**

Accept only JSON object with `confirmed === true`. Invalid JSON or missing confirmation returns:

```json
{ "error": "Подтвердите реальный overflow-тест." }
```

with status 400. Extra fields are ignored only if they do not attempt to supply model, endpoint, token target or credentials; reject those names to prevent the browser from controlling server bindings.

- [ ] **Step 2: Map service failures once**

- configuration → 500;
- validation → 400;
- completed provider response, including `rejected` → 200 with persisted run;
- network failure → 502 with the persisted `network_error` run.

Unexpected errors are logged once with model ID and duration only. Never log request body, generated input or headers.

- [ ] **Step 3: Add route-level smoke coverage to the existing service test**

Call the exported route handler with a Request and injected service seam if the project pattern supports it. Otherwise keep route mechanically thin and verify the service contract plus a throwaway HTTP smoke after server start; do not add a test that asserts source wiring.

- [ ] **Step 4: Verify Stage 3 and commit**

```bash
npx tsx --test tests/overflow-experiment.test.ts tests/token-counter.test.ts tests/conversation-usage.test.ts
npm run lint -- src/lib/overflow-experiment.ts src/app/api/token-experiments/overflow/route.ts tests/overflow-experiment.test.ts
npx tsc --noEmit
git diff --check
```

Expected: every outcome and zero-retry invariant passes.

Commit:

```bash
git add src/lib/overflow-experiment.ts src/app/api/token-experiments/overflow/route.ts tests/overflow-experiment.test.ts
git commit -m "feat(day-8): run real context overflow experiment"
```


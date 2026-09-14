# Этап 1: tokenizer, model profiles и preflight

## Task 1: Добавить Transformers.js и официальные tokenizer assets

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.env.example`
- Create: `tokenizers/manifest.json`
- Create: `tokenizers/deepseek-v4/tokenizer.json`
- Create: `tokenizers/deepseek-v4/tokenizer_config.json`
- Create: `tokenizers/nemotron-3-embed-1b/tokenizer.json`
- Create: `tokenizers/nemotron-3-embed-1b/tokenizer_config.json`

**Interfaces:**
- Produces local directories consumed by `AutoTokenizer.from_pretrained()`.
- Produces `OPENROUTER_API_KEY` as an optional documented server binding.

- [ ] **Step 1: Install the pinned tokenizer runtime**

Run:

```bash
npm install @huggingface/transformers@4.2.0
```

Expected: `package.json` contains `"@huggingface/transformers": "^4.2.0"`; lockfile resolves 4.2.0 without changing unrelated top-level versions.

- [ ] **Step 2: Download the official DeepSeek tokenizer package**

Run outside the repository, then copy only the two required files:

```bash
curl -L --fail --output /tmp/deepseek_v4_tokenizer.zip \
  https://cdn.deepseek.com/api-docs/deepseek_v4_tokenizer.zip
unzip -j /tmp/deepseek_v4_tokenizer.zip \
  'deepseek_v4_tokenizer/tokenizer.json' \
  'deepseek_v4_tokenizer/tokenizer_config.json' \
  -d tokenizers/deepseek-v4
rm /tmp/deepseek_v4_tokenizer.zip
```

Expected sizes: `tokenizer.json` 6,367,096 bytes; `tokenizer_config.json` 3,128 bytes.

- [ ] **Step 3: Download NVIDIA tokenizer assets at an immutable revision**

```bash
curl -L --fail --output tokenizers/nemotron-3-embed-1b/tokenizer.json \
  'https://huggingface.co/nvidia/Nemotron-3-Embed-1B-BF16/resolve/c0c9fea93ea424587517f2c59e20db9f1d6bf615/tokenizer.json?download=true'
curl -L --fail --output tokenizers/nemotron-3-embed-1b/tokenizer_config.json \
  'https://huggingface.co/nvidia/Nemotron-3-Embed-1B-BF16/resolve/c0c9fea93ea424587517f2c59e20db9f1d6bf615/tokenizer_config.json?download=true'
```

Expected sizes: `tokenizer.json` 17,077,678 bytes; `tokenizer_config.json` 21,139 bytes. A size mismatch stops implementation before the files are committed.

- [ ] **Step 4: Record provenance and computed checksums**

Run:

```bash
sha256sum tokenizers/deepseek-v4/* tokenizers/nemotron-3-embed-1b/*
```

Create `tokenizers/manifest.json` with one entry per file:

```json
{
  "deepseek-v4": {
    "source": "https://cdn.deepseek.com/api-docs/deepseek_v4_tokenizer.zip",
    "files": {
      "tokenizer.json": { "bytes": 6367096, "sha256": "89085f12ef79460ac5f66d1119325ddfc694b4ab209d80bbd81d35f081dc9614" },
      "tokenizer_config.json": { "bytes": 3128, "sha256": "841f8cf146e3f0ad1082594a31f68ecf7608c20467ef355081333d85bbaeb1cb" }
    }
  },
  "nemotron-3-embed-1b": {
    "source": "https://huggingface.co/nvidia/Nemotron-3-Embed-1B-BF16",
    "revision": "c0c9fea93ea424587517f2c59e20db9f1d6bf615",
    "files": {
      "tokenizer.json": { "bytes": 17077678, "sha256": "797410dfb649a5b9ba92bc4fef7dbf4022d00e73de6867c4ac199a8846439421" },
      "tokenizer_config.json": { "bytes": 21139, "sha256": "7bbb77c55282bc679b86d21a1b3953ed8d5d63aaf75f10800c20596eab30b980" }
    }
  }
}
```

Copy the complete command output exactly; all four hashes above must match before assets are committed.

- [ ] **Step 5: Document the OpenRouter binding without its value**

Append to `.env.example`:

```dotenv
# Day 8 real overflow experiment only.
OPENROUTER_API_KEY=
```

Add the user-provided value only to `.env.local`. Never print or read the value back.

- [ ] **Step 6: Verify assets are server inputs, not ignored artifacts**

Run:

```bash
node -e "const m=require('./tokenizers/manifest.json'); if(!m['deepseek-v4']||!m['nemotron-3-embed-1b']) process.exit(1)"
git status --short
```

Expected: four tokenizer files and manifest are tracked candidates; `.env.local` is absent from status.

## Task 2: Define explicit model and price profiles

**Files:**
- Create: `src/lib/model-profiles.ts`
- Create: `src/lib/token-cost.ts`
- Create: `tests/token-cost.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `DEEPSEEK_FLASH_PROFILE`, `NEMOTRON_OVERFLOW_PROFILE`, `getLiveModelProfile()`.
- Produces `getTariffBand(at)`, `calculateDeepSeekCost(input)`, integer micro-USD output.

- [ ] **Step 1: Implement model profiles**

Create immutable structures:

```ts
export const DEEPSEEK_FLASH_PROFILE = {
  acceptedIds: ["deepseek-v4-flash", "deepseek-flash"],
  tokenizer: "deepseek-v4",
  contextWindow: 1_000_000,
  maxOutputTokens: 393_216,
  responseReserveTokens: 4_096,
  pricing: {
    peak: { cacheHitInputPerMillion: 0.006, cacheMissInputPerMillion: 0.3, outputPerMillion: 1.2 },
    offPeak: { cacheHitInputPerMillion: 0.003, cacheMissInputPerMillion: 0.15, outputPerMillion: 0.6 },
  },
  pricingSource: "https://api-docs.deepseek.com/quick_start/pricing/",
  pricingCheckedAt: "2026-09-14",
} as const;

export const NEMOTRON_OVERFLOW_PROFILE = {
  model: "nvidia/nemotron-3-embed-1b:free",
  tokenizer: "nemotron-3-embed-1b",
  endpoint: "https://openrouter.ai/api/v1/embeddings",
  contextWindow: 32_768,
  targetInputTokens: 33_280,
  costMicrosUsd: 0,
  metadataSource: "https://openrouter.ai/nvidia/nemotron-3-embed-1b:free",
  tokenizerSource: "https://huggingface.co/nvidia/Nemotron-3-Embed-1B-BF16",
  tokenizerRevision: "c0c9fea93ea424587517f2c59e20db9f1d6bf615",
} as const;
```

`getLiveModelProfile(model)` accepts only the two DeepSeek aliases and throws a configuration error naming the unsupported model.

- [ ] **Step 2: Implement tariff selection and cost math**

Use UTC only. Peak means Monday through Friday and hour in `[1,4)` or `[6,10)`.

```ts
export function getTariffBand(at: Date): "peak" | "off-peak";

export function calculateDeepSeekCost(input: {
  promptTokens: number;
  completionTokens: number;
  cacheHitTokens: number | null;
  cacheMissTokens: number | null;
  at: Date;
}): { tariffBand: "peak" | "off-peak"; costMicrosUsd: number };
```

When cache breakdown is absent, charge every prompt token at cache-miss rate. Validate every token count as a non-negative safe integer. Round once at the final micro-USD boundary:

```ts
Math.round(costUsd * 1_000_000)
```

- [ ] **Step 3: Add post-implementation cost tests**

Create tests for:

```ts
assert.equal(getTariffBand(new Date("2026-09-14T02:00:00Z")), "peak");
assert.equal(getTariffBand(new Date("2026-09-13T02:00:00Z")), "off-peak");
assert.equal(getTariffBand(new Date("2026-09-14T05:00:00Z")), "off-peak");
```

Cover cache split, missing cache fields, output cost and negative input rejection. Tests are written after the production functions, per the approved no-TDD workflow.

- [ ] **Step 4: Add the token test command**

Set:

```json
"test:tokens": "tsx --test tests/token-counter.test.ts tests/token-cost.test.ts tests/chat-agent-usage.test.ts tests/conversation-usage.test.ts tests/overflow-experiment.test.ts"
```

The command may reference later test files; do not run it until their owning tasks create them. Run the current file directly:

```bash
npx tsx --test tests/token-cost.test.ts
```

Expected: all cost tests pass.

## Task 3: Implement server-only token counting and preflight

**Files:**
- Create: `src/lib/token-counter.ts`
- Create: `tests/token-counter.test.ts`

**Interfaces:**
- Consumes model profiles and local tokenizer directories.
- Produces `countChatPrompt()`, `countTextTokens()`, `assertContextFits()`, `buildOverflowInput()`.

- [ ] **Step 1: Implement lazy local tokenizer loading**

Start the module with:

```ts
import "server-only";
import path from "node:path";
import { AutoTokenizer, env } from "@huggingface/transformers";

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = path.join(process.cwd(), "tokenizers");
```

Keep `Map<string, Promise<PreTrainedTokenizer>>`; cache the promise before awaiting it so concurrent requests share one load. Use `local_files_only: true`.

- [ ] **Step 2: Count full chat templates and prefix differences**

Expose:

```ts
export async function countChatPrompt(input: {
  systemPrompt: string;
  history: ChatMessage[];
  request: string;
  contextLimit: number;
  reservedOutputTokens: number;
}): Promise<TokenBreakdown>;
```

Call `apply_chat_template` for `[system]`, `[system, ...history]` and `[system, ...history, user]` with tokenization enabled and generation prompt enabled only for the full request. Derive non-negative segment differences and assert:

```ts
promptTokens === systemTokens + historyTokens + requestTokens
contextTokens === promptTokens + reservedOutputTokens
```

- [ ] **Step 3: Add the explicit context error**

```ts
export class ContextLimitError extends Error {
  readonly status = 422;
  constructor(readonly breakdown: TokenBreakdown) {
    super(`Контекст превышен на ${breakdown.contextTokens - breakdown.contextLimit} токенов.`);
  }
}

export function assertContextFits(breakdown: TokenBreakdown): void {
  if (breakdown.contextTokens > breakdown.contextLimit) throw new ContextLimitError(breakdown);
}
```

Equality with the limit passes; one token above fails.

- [ ] **Step 4: Implement exact overflow input generation**

```ts
export async function buildOverflowInput(
  targetTokens = NEMOTRON_OVERFLOW_PROFILE.targetInputTokens,
): Promise<{ text: string; tokens: number }>;
```

Repeat a deterministic retrieval-oriented sentence, count with the Nemotron tokenizer and use bounded binary search on repetition count until `tokens >= 33_280 && tokens <= 33_344`. Throw if the interval cannot be reached. Return only in server code.

- [ ] **Step 5: Add post-implementation tokenizer tests**

Use short fixed strings with counts obtained from the checked-in tokenizer and assert stable exact counts. Test prefix invariants and context boundaries:

```ts
assert.doesNotThrow(() => assertContextFits({ ...breakdown, contextTokens: 999_999 }));
assert.doesNotThrow(() => assertContextFits({ ...breakdown, contextTokens: 1_000_000 }));
assert.throws(
  () => assertContextFits({ ...breakdown, contextTokens: 1_000_001 }),
  ContextLimitError,
);
```

Generate overflow input once and assert its count range; set the test timeout explicitly because first tokenizer load reads a 17 MB asset.

- [ ] **Step 6: Verify Stage 1 and commit**

Run:

```bash
npx tsx --test tests/token-counter.test.ts tests/token-cost.test.ts
npm run lint -- src/lib/model-profiles.ts src/lib/token-cost.ts src/lib/token-counter.ts tests/token-counter.test.ts tests/token-cost.test.ts
npx tsc --noEmit
git diff --check
git status --short
```

Expected: tests, lint and types pass; no `.env.local` or temporary archive appears.

Commit:

```bash
git add package.json package-lock.json .env.example tokenizers src/lib/model-profiles.ts src/lib/token-cost.ts src/lib/token-counter.ts tests/token-counter.test.ts tests/token-cost.test.ts
git commit -m "feat(day-8): add model token accounting"
```

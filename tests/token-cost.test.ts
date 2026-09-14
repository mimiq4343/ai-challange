import assert from "node:assert/strict";
import { test } from "node:test";

import { calculateDeepSeekCost, getTariffBand } from "../src/lib/token-cost";

test("selects DeepSeek peak windows in UTC on weekdays only", () => {
  assert.equal(getTariffBand(new Date("2026-09-14T02:00:00Z")), "peak");
  assert.equal(getTariffBand(new Date("2026-09-14T05:00:00Z")), "off-peak");
  assert.equal(getTariffBand(new Date("2026-09-14T06:00:00Z")), "peak");
  assert.equal(getTariffBand(new Date("2026-09-13T02:00:00Z")), "off-peak");
});

test("charges unclassified prompt tokens as cache misses", () => {
  assert.deepEqual(
    calculateDeepSeekCost({
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      cacheHitTokens: null,
      cacheMissTokens: null,
      at: new Date("2026-09-14T05:00:00Z"),
    }),
    { tariffBand: "off-peak", costMicrosUsd: 750_000 },
  );
});

test("uses the reported cache split and peak output price", () => {
  assert.deepEqual(
    calculateDeepSeekCost({
      promptTokens: 1_000_000,
      completionTokens: 100_000,
      cacheHitTokens: 500_000,
      cacheMissTokens: 500_000,
      at: new Date("2026-09-14T02:00:00Z"),
    }),
    { tariffBand: "peak", costMicrosUsd: 273_000 },
  );
});

test("rejects invalid token counts and cache totals", () => {
  assert.throws(
    () =>
      calculateDeepSeekCost({
        promptTokens: -1,
        completionTokens: 0,
        cacheHitTokens: null,
        cacheMissTokens: null,
        at: new Date(),
      }),
    TypeError,
  );
  assert.throws(
    () =>
      calculateDeepSeekCost({
        promptTokens: 10,
        completionTokens: 0,
        cacheHitTokens: 8,
        cacheMissTokens: 3,
        at: new Date(),
      }),
    RangeError,
  );
});

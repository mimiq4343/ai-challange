import type { TariffBand } from "./conversation-types";
import { DEEPSEEK_FLASH_PROFILE } from "./model-profiles";

export type DeepSeekCostInput = {
  promptTokens: number;
  completionTokens: number;
  cacheHitTokens: number | null;
  cacheMissTokens: number | null;
  at: Date;
};

function assertTokenCount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} должен быть неотрицательным целым числом.`);
  }
}

export function getTariffBand(at: Date): TariffBand {
  if (Number.isNaN(at.getTime())) {
    throw new TypeError("Дата тарифа недействительна.");
  }

  const day = at.getUTCDay();
  const hour = at.getUTCHours();
  const weekday = day >= 1 && day <= 5;
  const peakHour = (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);

  return weekday && peakHour ? "peak" : "off-peak";
}

export function calculateDeepSeekCost(input: DeepSeekCostInput): {
  tariffBand: TariffBand;
  costMicrosUsd: number;
} {
  assertTokenCount(input.promptTokens, "promptTokens");
  assertTokenCount(input.completionTokens, "completionTokens");

  if (input.cacheHitTokens !== null) {
    assertTokenCount(input.cacheHitTokens, "cacheHitTokens");
  }
  if (input.cacheMissTokens !== null) {
    assertTokenCount(input.cacheMissTokens, "cacheMissTokens");
  }

  const cacheHitTokens = input.cacheHitTokens ?? 0;
  const reportedCacheMissTokens = input.cacheMissTokens ?? 0;
  if (cacheHitTokens + reportedCacheMissTokens > input.promptTokens) {
    throw new RangeError("Cache token breakdown превышает promptTokens.");
  }

  const cacheMissTokens = input.promptTokens - cacheHitTokens;
  const tariffBand = getTariffBand(input.at);
  const prices = DEEPSEEK_FLASH_PROFILE.pricing[
    tariffBand === "peak" ? "peak" : "offPeak"
  ];
  const costUsd =
    (cacheHitTokens * prices.cacheHitInputPerMillion +
      cacheMissTokens * prices.cacheMissInputPerMillion +
      input.completionTokens * prices.outputPerMillion) /
    1_000_000;

  return {
    tariffBand,
    costMicrosUsd: Math.round(costUsd * 1_000_000),
  };
}

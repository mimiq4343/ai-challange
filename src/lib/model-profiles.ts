export const DEEPSEEK_FLASH_PROFILE = {
  acceptedIds: ["deepseek-v4-flash", "deepseek-flash"],
  tokenizer: "deepseek-v4",
  contextWindow: 1_000_000,
  maxOutputTokens: 393_216,
  /**
   * Модель рассуждающая: reasoning_content списывается из того же лимита, что и
   * ответ. При 4 096 токенов сложные запросы упирались в лимит на рассуждениях и
   * возвращали пустой content с finish_reason = length.
   */
  responseReserveTokens: 16_384,
  pricing: {
    peak: {
      cacheHitInputPerMillion: 0.006,
      cacheMissInputPerMillion: 0.3,
      outputPerMillion: 1.2,
    },
    offPeak: {
      cacheHitInputPerMillion: 0.003,
      cacheMissInputPerMillion: 0.15,
      outputPerMillion: 0.6,
    },
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

export type DeepSeekFlashProfile = typeof DEEPSEEK_FLASH_PROFILE;

export function getLiveModelProfile(model: string): DeepSeekFlashProfile {
  if (!DEEPSEEK_FLASH_PROFILE.acceptedIds.some((id) => id === model)) {
    throw new Error(`Нет профиля токенов для модели ${model}.`);
  }

  return DEEPSEEK_FLASH_PROFILE;
}

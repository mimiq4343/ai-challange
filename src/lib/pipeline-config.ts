export const PIPELINE_MCP_URL = "https://mcp.yees.ai/mcp/pipeline";

// DeepSeek разрешает обязательный следующий tool call только без thinking.
// Это настройка координатора; генерация самого обзора сохраняет thinking.
export const PIPELINE_MODEL_SETTINGS = { thinking: { type: "disabled" } } as const;

export const PIPELINE_LIMITS = {
  queryMaxChars: 200,
  maxRepositories: 5,
  searchTimeoutMs: 8_000,
  summaryTimeoutMs: 75_000,
  toolTimeoutMs: 90_000,
  summaryMaxBytes: 12 * 1024,
  // DeepSeek Flash тратит этот бюджет также на скрытые рассуждения.
  summaryMaxTokens: 16_384,
  toolResultMaxBytes: 32 * 1024,
  reportLimit: 20,
} as const;

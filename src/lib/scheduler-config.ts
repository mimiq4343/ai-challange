export const SCHEDULER_MCP_URL = "https://mcp.yees.ai/mcp/scheduler";

// Ограничения общие для MCP, worker и интерфейса; секреты остаются в окружении.
export const SCHEDULER_LIMITS = {
  minIntervalMinutes: 15,
  maxIntervalMinutes: 10_080,
  maxActiveJobs: 5,
  pollIntervalMs: 5_000,
  runTimeoutMs: 90_000,
  leaseMs: 120_000,
  summaryMaxTokens: 1_024,
  summaryMaxBytes: 16_384,
  maxPeriodHours: 720,
  defaultPeriodHours: 24,
  feedLimit: 20,
} as const;

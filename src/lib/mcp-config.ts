export const MCP_PUBLIC_URL = "https://mcp.yees.ai/mcp";
export const MCP_DISCOVERY_TIMEOUT_MS = 15_000;
export const MCP_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MCP_MAX_TOOL_PAGES = 100;
export const MCP_SERVER_RESPONSE_TIMEOUT_MS = 10_000;
export const MCP_SESSION_CLEANUP_TIMEOUT_MS = 3_000;

// Ограничения tool loop версионируются вместе с кодом, а не через окружение.
export const MCP_TOOL_CHAT_LIMITS = {
  timeoutMs: 180_000,
  maxRounds: 4,
  maxToolCalls: 4,
  maxToolsPerRound: 2,
  maxContextBytes: 512 * 1024,
  maxProviderResponseBytes: 4 * 1024 * 1024,
  maxToolResultBytes: 32 * 1024,
  maxToolDefinitionBytes: 16 * 1024,
  maxArgumentsBytes: 2 * 1024,
  maxCallIdBytes: 128,
} as const;

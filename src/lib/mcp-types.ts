export type McpServerInput = {
  name: string;
  url: string;
};

export type McpServerConfig = McpServerInput & {
  id: number;
  profileId: number;
  createdAt: string;
};

export type McpTool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

export type McpDiscoveryResult = {
  server: { name: string; version: string };
  tools: McpTool[];
  checkedAt: string;
};

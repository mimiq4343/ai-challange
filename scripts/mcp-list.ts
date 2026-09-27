import { discoverMcpTools } from "../src/lib/mcp-client";

async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url || process.argv.length !== 3) {
    throw new Error("Использование: npm run mcp:list -- https://mcp.yees.ai/mcp");
  }
  const discovery = await discoverMcpTools(url);
  console.log(JSON.stringify(discovery, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Ошибка MCP-подключения.");
  process.exitCode = 1;
});

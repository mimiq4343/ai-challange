import { readProjectBranch } from "@/lib/dev-assistant-http";
import { McpConnectionError } from "@/lib/mcp-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request): Promise<Response> {
  try {
    return Response.json(await readProjectBranch(request.signal), { headers });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499, headers });
    if (error instanceof McpConnectionError) return Response.json({ error: error.message }, { status: error.status, headers });
    console.error("dev_assistant_branch_failed", { error: error instanceof Error ? error.name : "UnknownError" });
    return Response.json({ error: "Не удалось получить текущую ветку через MCP." }, { status: 502, headers });
  }
}

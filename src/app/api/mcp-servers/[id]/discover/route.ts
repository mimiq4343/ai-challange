import { parseMcpServerId, readMcpObjectBody, validateMcpMutation } from "@/lib/mcp-api";
import { discoverMcpTools, McpConnectionError } from "@/lib/mcp-client";
import { McpValidationError } from "@/lib/mcp-network";
import { getMcpServerStore } from "@/lib/mcp-store";
import { getProfileStore } from "@/lib/profile-store";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const rejected = validateMcpMutation(request);
  if (rejected) return rejected;
  const id = parseMcpServerId((await context.params).id);
  if (id === null) {
    return Response.json({ error: "Некорректный идентификатор MCP-сервера." }, { status: 400 });
  }
  const body = await readMcpObjectBody(request);
  if (body instanceof Response) return body;
  if (Object.keys(body).length !== 0) {
    return Response.json(
      { error: "Для проверки отправьте пустой JSON-объект: параметры берутся из сохранённого сервера." },
      { status: 400 },
    );
  }

  const profile = getProfileStore().getActiveProfile();
  const server = getMcpServerStore().getServer(profile.id, id);
  if (!server) {
    return Response.json({ error: "MCP-сервер не найден." }, { status: 404 });
  }
  try {
    const discovery = await discoverMcpTools(server.url);
    return Response.json({ discovery });
  } catch (error) {
    if (error instanceof McpConnectionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof McpValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

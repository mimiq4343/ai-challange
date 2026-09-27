import { parseMcpServerId, validateMcpMutation } from "@/lib/mcp-api";
import { getMcpServerStore } from "@/lib/mcp-store";
import { getProfileStore } from "@/lib/profile-store";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  const rejected = validateMcpMutation(request);
  if (rejected) return rejected;
  const id = parseMcpServerId((await context.params).id);
  if (id === null) {
    return Response.json({ error: "Некорректный идентификатор MCP-сервера." }, { status: 400 });
  }

  const profile = getProfileStore().getActiveProfile();
  const store = getMcpServerStore();
  if (!store.delete(profile.id, id)) {
    return Response.json({ error: "MCP-сервер не найден." }, { status: 404 });
  }
  return Response.json({ servers: store.listServers(profile.id) });
}

import { readMcpObjectBody, validateMcpMutation } from "@/lib/mcp-api";
import { McpValidationError } from "@/lib/mcp-network";
import {
  DuplicateMcpServerError,
  getMcpServerStore,
  McpServerValidationError,
} from "@/lib/mcp-store";
import { getProfileStore } from "@/lib/profile-store";

export const runtime = "nodejs";

export async function GET() {
  const profile = getProfileStore().getActiveProfile();
  return Response.json({ servers: getMcpServerStore().listServers(profile.id) });
}

export async function POST(request: Request) {
  const rejected = validateMcpMutation(request);
  if (rejected) return rejected;
  const body = await readMcpObjectBody(request);
  if (body instanceof Response) return body;
  if (
    typeof body.name !== "string" ||
    typeof body.url !== "string" ||
    Object.keys(body).some((key) => key !== "name" && key !== "url")
  ) {
    return Response.json(
      { error: "Укажите только название и URL MCP-сервера: поля name и url." },
      { status: 400 },
    );
  }

  const profile = getProfileStore().getActiveProfile();
  const store = getMcpServerStore();
  try {
    store.create(profile.id, { name: body.name, url: body.url });
  } catch (error) {
    if (error instanceof DuplicateMcpServerError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof McpValidationError || error instanceof McpServerValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
  return Response.json({ servers: store.listServers(profile.id) }, { status: 201 });
}

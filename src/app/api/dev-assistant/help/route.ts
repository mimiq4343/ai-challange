import { handleHelpCommand } from "@/lib/dev-assistant-http";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleHelpCommand(request);
}

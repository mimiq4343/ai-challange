import { handleFileAssistant } from "@/lib/file-assistant-http";

export const runtime = "nodejs";
export async function POST(request: Request) { return handleFileAssistant(request); }

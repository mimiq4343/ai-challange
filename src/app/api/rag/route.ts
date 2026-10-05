import { ragResponse } from "@/lib/rag-http";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return ragResponse(request);
}

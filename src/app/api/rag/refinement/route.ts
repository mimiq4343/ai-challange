import { refinementResponse } from "@/lib/rag-refinement-http";

export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  return refinementResponse(request);
}

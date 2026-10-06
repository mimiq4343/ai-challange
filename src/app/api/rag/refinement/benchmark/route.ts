import { refinementBenchmarkResponse } from "@/lib/rag-refinement-http";

export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  return refinementBenchmarkResponse(request);
}

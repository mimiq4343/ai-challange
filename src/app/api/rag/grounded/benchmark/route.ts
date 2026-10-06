import { groundingBenchmarkResponse } from "@/lib/rag-grounding-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  return groundingBenchmarkResponse(request);
}

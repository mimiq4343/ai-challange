import { handleReviewAgent } from "@/lib/code-review-agent-http";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleReviewAgent(request);
}

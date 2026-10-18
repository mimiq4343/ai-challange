import { handleCodeReview } from "@/lib/code-review-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleCodeReview(request);
}

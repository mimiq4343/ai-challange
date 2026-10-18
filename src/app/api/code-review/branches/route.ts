import { readReviewWorkspace } from "@/lib/code-review-git";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  try {
    return Response.json(await readReviewWorkspace(process.cwd(), request.signal), { headers });
  } catch (cause) {
    if (request.signal.aborted) return new Response(null, { status: 499, headers });
    console.error("code_review_branches_failed", { error: cause instanceof Error ? cause.name : "UnknownError" });
    return Response.json({ error: "Не удалось прочитать ветки репозитория GitHub на сервере." }, { status: 502, headers });
  }
}

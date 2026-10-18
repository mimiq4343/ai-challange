import { readSupportTicket, supportHttpError } from "@/lib/support-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return Response.json(await readSupportTicket((await params).id), { headers: { "Cache-Control": "no-store" } }); }
  catch (cause) { return supportHttpError(cause); }
}

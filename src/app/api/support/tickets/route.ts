import { loadSupportData } from "@/lib/support-data";
import { supportHttpError } from "@/lib/support-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await loadSupportData();
    return Response.json({ demo: true, tickets: data.tickets.map(ticket => ({ ...ticket, userName: data.users.find(user => user.id === ticket.userId)!.name })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) { return supportHttpError(cause); }
}

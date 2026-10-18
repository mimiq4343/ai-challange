import { handleSupportMessage } from "@/lib/support-http";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleSupportMessage(request, (await params).id);
}

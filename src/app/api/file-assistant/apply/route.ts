import { handleApplyFileProposal } from "@/lib/file-assistant-http";

export const runtime = "nodejs";
export async function POST(request: Request) { return handleApplyFileProposal(request); }

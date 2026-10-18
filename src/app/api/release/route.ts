import { handleRelease } from "@/lib/release-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return handleRelease(request); }

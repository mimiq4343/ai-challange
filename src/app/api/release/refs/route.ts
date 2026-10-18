import { handleReleaseWorkspace } from "@/lib/release-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return handleReleaseWorkspace(request); }

import { getContextStrategyStore } from "@/lib/context-strategy-store";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ run: getContextStrategyStore().getLatestBenchmarkRun() });
}

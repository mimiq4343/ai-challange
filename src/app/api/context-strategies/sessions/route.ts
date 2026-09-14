import { getContextStrategyStore } from "@/lib/context-strategy-store";
import type { ContextStrategy } from "@/lib/context-strategy-types";

export const runtime = "nodejs";

const STRATEGIES: Record<ContextStrategy, true> = {
  sliding: true,
  facts: true,
  branching: true,
};

export async function GET() {
  return Response.json({ sessions: getContextStrategyStore().listSessions() });
}

export async function POST(request: Request) {
  let strategy: unknown;
  try {
    ({ strategy } = await request.json());
  } catch {
    return Response.json({ error: "Некорректный JSON." }, { status: 400 });
  }
  if (typeof strategy !== "string" || !Object.hasOwn(STRATEGIES, strategy)) {
    return Response.json({ error: "Неизвестная стратегия контекста." }, { status: 400 });
  }
  const session = getContextStrategyStore().createSession(strategy as ContextStrategy);
  return Response.json({ session }, { status: 201 });
}

import {
  ContextSessionNotFoundError,
  ContextStrategyStateError,
  getContextStrategyStore,
} from "@/lib/context-strategy-store";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string; branchId: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const { id, branchId } = await context.params;
  try {
    const detail = getContextStrategyStore().activateBranch(id, branchId);
    return Response.json({ detail });
  } catch (error) {
    if (error instanceof ContextSessionNotFoundError) {
      return Response.json({ error: "Сессия не найдена." }, { status: 404 });
    }
    if (error instanceof ContextStrategyStateError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}

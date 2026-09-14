import {
  ContextSessionNotFoundError,
  getContextStrategyStore,
} from "@/lib/context-strategy-store";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    return Response.json({ detail: getContextStrategyStore().getDetail(id) });
  } catch (error) {
    if (error instanceof ContextSessionNotFoundError) {
      return Response.json({ error: "Сессия не найдена." }, { status: 404 });
    }
    throw error;
  }
}

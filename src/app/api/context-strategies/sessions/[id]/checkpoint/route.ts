import {
  ContextSessionNotFoundError,
  ContextStrategyStateError,
  getContextStrategyStore,
} from "@/lib/context-strategy-store";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const store = getContextStrategyStore();
  try {
    store.createCheckpoint(id);
    return Response.json({ detail: store.getDetail(id) }, { status: 201 });
  } catch (error) {
    if (error instanceof ContextSessionNotFoundError) {
      return Response.json({ error: "Сессия не найдена." }, { status: 404 });
    }
    if (error instanceof ContextStrategyStateError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}

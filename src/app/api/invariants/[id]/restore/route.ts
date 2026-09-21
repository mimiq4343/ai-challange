import { InvariantNotFoundError, getInvariantStore } from "@/lib/invariant-store";
import { getProfileStore } from "@/lib/profile-store";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const invariantId = Number(id);
  if (!Number.isSafeInteger(invariantId) || invariantId <= 0) {
    return Response.json({ error: "Некорректный идентификатор." }, { status: 400 });
  }

  const store = getInvariantStore();
  try {
    store.setStatus(invariantId, "active");
  } catch (error) {
    if (error instanceof InvariantNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }

  return Response.json({
    invariants: store.getSnapshot(getProfileStore().getActiveProfile().id),
  });
}

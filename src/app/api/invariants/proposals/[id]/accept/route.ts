import {
  DuplicateInvariantError,
  InvariantNotFoundError,
  getInvariantStore,
} from "@/lib/invariant-store";
import { getProfileStore } from "@/lib/profile-store";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const proposalId = Number(id);
  if (!Number.isSafeInteger(proposalId) || proposalId <= 0) {
    return Response.json({ error: "Некорректный идентификатор." }, { status: 400 });
  }

  const store = getInvariantStore();
  try {
    store.acceptProposal(proposalId);
  } catch (error) {
    if (error instanceof InvariantNotFoundError) {
      return Response.json({ error: "Предложение не найдено." }, { status: 404 });
    }
    if (error instanceof DuplicateInvariantError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  return Response.json({
    invariants: store.getSnapshot(getProfileStore().getActiveProfile().id),
  });
}

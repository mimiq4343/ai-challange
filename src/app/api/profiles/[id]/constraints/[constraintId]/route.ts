import { getProfileStore } from "@/lib/profile-store";
import { FEATURES, PERSONALIZATION_DISABLED_MESSAGE } from "@/lib/feature-flags";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; constraintId: string }> };

export async function DELETE(_request: Request, context: RouteContext) {
  if (!FEATURES.personalization) {
    return Response.json({ error: PERSONALIZATION_DISABLED_MESSAGE }, { status: 404 });
  }

  const { id, constraintId } = await context.params;
  const profileId = Number(id);
  const numericConstraintId = Number(constraintId);
  if (
    !Number.isSafeInteger(profileId) ||
    profileId <= 0 ||
    !Number.isSafeInteger(numericConstraintId) ||
    numericConstraintId <= 0
  ) {
    return Response.json({ error: "Некорректный идентификатор." }, { status: 400 });
  }

  if (!getProfileStore().deleteConstraint(profileId, numericConstraintId)) {
    return Response.json({ error: "Ограничение не найдено." }, { status: 404 });
  }

  return new Response(null, { status: 204 });
}

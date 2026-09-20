import { ProfileNotFoundError, getProfileStore } from "@/lib/profile-store";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const profileId = Number(id);
  if (!Number.isSafeInteger(profileId) || profileId <= 0) {
    return Response.json({ error: "Некорректный идентификатор профиля." }, { status: 400 });
  }

  try {
    return Response.json({ profile: getProfileStore().activateProfile(profileId) });
  } catch (error) {
    if (error instanceof ProfileNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}

import { parseProfileBody } from "@/app/api/profiles/route";
import {
  LastProfileError,
  ProfileNotFoundError,
  getProfileStore,
} from "@/lib/profile-store";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const profileId = Number(id);
  if (!Number.isSafeInteger(profileId) || profileId <= 0) {
    return Response.json({ error: "Некорректный идентификатор профиля." }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Некорректный JSON в теле запроса." }, { status: 400 });
  }

  const parsed = parseProfileBody(body);
  if ("error" in parsed) return Response.json(parsed, { status: 400 });

  const store = getProfileStore();
  const duplicate = store
    .listProfiles()
    .some((profile) => profile.name === parsed.name && profile.id !== profileId);
  if (duplicate) {
    return Response.json({ error: "Профиль с таким именем уже есть." }, { status: 409 });
  }

  try {
    return Response.json({ profile: store.updateProfile(profileId, parsed) });
  } catch (error) {
    if (error instanceof ProfileNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const profileId = Number(id);
  if (!Number.isSafeInteger(profileId) || profileId <= 0) {
    return Response.json({ error: "Некорректный идентификатор профиля." }, { status: 400 });
  }

  try {
    return Response.json({ activeProfile: getProfileStore().deleteProfile(profileId) });
  } catch (error) {
    if (error instanceof ProfileNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof LastProfileError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}

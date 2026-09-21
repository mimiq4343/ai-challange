import { ProfileNotFoundError, getProfileStore } from "@/lib/profile-store";

export const runtime = "nodejs";

const MAX_CONSTRAINT_LENGTH = 200;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
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

  const value = typeof body.value === "string" ? body.value.trim() : "";
  if (value.length === 0 || value.length > MAX_CONSTRAINT_LENGTH) {
    return Response.json(
      { error: `Ограничение: от 1 до ${MAX_CONSTRAINT_LENGTH} символов.` },
      { status: 400 },
    );
  }

  try {
    const constraint = getProfileStore().addConstraint(
      profileId,
      value,
      "user",
      "добавлено вручную",
    );
    if (!constraint) {
      return Response.json({ error: "Такое ограничение уже есть." }, { status: 409 });
    }
    return Response.json({ constraint }, { status: 201 });
  } catch (error) {
    if (error instanceof ProfileNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}

import { getProfileStore } from "@/lib/profile-store";
import {
  isPreferenceValue,
  PROFILE_FIELD_VALUES,
  type ProfileEnumField,
  type ProfileInput,
} from "@/lib/profile-types";

export const runtime = "nodejs";

const MAX_NAME_LENGTH = 40;
const MAX_ROLE_LENGTH = 120;

export type ProfileFieldError = { error: string };

/**
 * Разбирает тело профиля. Незаполненные перечислимые поля берутся из значений
 * по умолчанию хранилища, недопустимые значения отклоняются.
 */
export function parseProfileBody(
  body: Record<string, unknown>,
): ProfileInput | ProfileFieldError {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    return { error: `Имя профиля: от 1 до ${MAX_NAME_LENGTH} символов.` };
  }

  const rawRole = typeof body.role === "string" ? body.role.trim() : "";
  if (rawRole.length > MAX_ROLE_LENGTH) {
    return { error: `Роль длиннее ${MAX_ROLE_LENGTH} символов.` };
  }

  const input: ProfileInput = { name, role: rawRole.length > 0 ? rawRole : null };
  for (const field of Object.keys(PROFILE_FIELD_VALUES) as ProfileEnumField[]) {
    const value = body[field];
    if (value === undefined) continue;
    if (typeof value !== "string" || !isPreferenceValue(field, value)) {
      return { error: `Недопустимое значение поля ${field}.` };
    }
    Object.assign(input, { [field]: value });
  }

  return input;
}

export async function GET() {
  const store = getProfileStore();
  return Response.json({
    profiles: store.listProfiles(),
    activeProfileId: store.getActiveProfile().id,
  });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Некорректный JSON в теле запроса." }, { status: 400 });
  }

  const parsed = parseProfileBody(body);
  if ("error" in parsed) return Response.json(parsed, { status: 400 });

  const store = getProfileStore();
  if (store.listProfiles().some((profile) => profile.name === parsed.name)) {
    return Response.json({ error: "Профиль с таким именем уже есть." }, { status: 409 });
  }

  const profile = store.createProfile(parsed);
  return Response.json({ profile }, { status: 201 });
}

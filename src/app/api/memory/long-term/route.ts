import { getMemoryStore } from "@/lib/memory-store";
import { getProfileStore } from "@/lib/profile-store";
import type { LongTermKind } from "@/lib/memory-types";

export const runtime = "nodejs";

const LONG_TERM_KINDS: Record<LongTermKind, true> = {
  profile: true,
  decision: true,
  knowledge: true,
};

const KEY_PATTERN = /^[a-z0-9_]{2,64}$/;

export async function GET() {
  const profile = getProfileStore().getActiveProfile();
  return Response.json({ entries: getMemoryStore().listLongTerm(profile.id) });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Некорректный JSON в теле запроса." }, { status: 400 });
  }

  const kind = body.kind;
  if (typeof kind !== "string" || !(kind in LONG_TERM_KINDS)) {
    return Response.json(
      { error: "Поле kind должно быть profile, decision или knowledge." },
      { status: 400 },
    );
  }

  const key = typeof body.key === "string" ? body.key.trim().toLowerCase() : "";
  if (!KEY_PATTERN.test(key)) {
    return Response.json(
      { error: "Ключ записи: от 2 до 64 символов латиницей, цифрами или подчёркиванием." },
      { status: 400 },
    );
  }

  const value = typeof body.value === "string" ? body.value.trim() : "";
  if (value.length === 0 || value.length > 400) {
    return Response.json(
      { error: "Значение записи должно быть непустым и не длиннее 400 символов." },
      { status: 400 },
    );
  }

  const conversationId =
    typeof body.conversationId === "string" && body.conversationId.length > 0
      ? body.conversationId
      : null;

  const entry = getMemoryStore().upsertLongTerm(
    {
      profileId: getProfileStore().getActiveProfile().id,
      kind: kind as LongTermKind,
      key,
      value,
      origin: "user",
      reason: "добавлено вручную",
      sourceConversationId: conversationId,
    },
    conversationId ? { conversationId, assistantMessageId: null } : undefined,
  );

  return Response.json({ entry }, { status: 201 });
}

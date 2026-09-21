import {
  DuplicateInvariantError,
  getInvariantStore,
} from "@/lib/invariant-store";
import type { InvariantCategory, InvariantInput } from "@/lib/invariant-types";
import { INVARIANT_CATEGORY_LABELS } from "@/lib/invariant-types";
import { getProfileStore } from "@/lib/profile-store";

export const runtime = "nodejs";

const MAX_STATEMENT_LENGTH = 300;
const MAX_RATIONALE_LENGTH = 400;

export type InvariantBodyError = { error: string };

export function parseInvariantBody(
  body: Record<string, unknown>,
): InvariantInput | InvariantBodyError {
  const category = body.category;
  if (typeof category !== "string" || !(category in INVARIANT_CATEGORY_LABELS)) {
    return { error: "Категория: architecture, tech_decision, stack или business_rule." };
  }

  const statement = typeof body.statement === "string" ? body.statement.trim() : "";
  if (statement.length === 0 || statement.length > MAX_STATEMENT_LENGTH) {
    return { error: `Формулировка: от 1 до ${MAX_STATEMENT_LENGTH} символов.` };
  }

  const rationale = typeof body.rationale === "string" ? body.rationale.trim() : "";
  if (rationale.length > MAX_RATIONALE_LENGTH) {
    return { error: `Обоснование длиннее ${MAX_RATIONALE_LENGTH} символов.` };
  }

  return {
    category: category as InvariantCategory,
    statement,
    rationale: rationale.length > 0 ? rationale : null,
  };
}

export async function GET() {
  const profile = getProfileStore().getActiveProfile();
  return Response.json({ invariants: getInvariantStore().getSnapshot(profile.id) });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Некорректный JSON в теле запроса." }, { status: 400 });
  }

  const parsed = parseInvariantBody(body);
  if ("error" in parsed) return Response.json(parsed, { status: 400 });

  const profile = getProfileStore().getActiveProfile();
  const store = getInvariantStore();
  try {
    store.create(profile.id, parsed, "user");
  } catch (error) {
    if (error instanceof DuplicateInvariantError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  return Response.json({ invariants: store.getSnapshot(profile.id) }, { status: 201 });
}

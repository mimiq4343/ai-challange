import {
  MemoryValidationError,
  getConversationStore,
} from "@/lib/conversation-store";
import type { LongTermMemoryCategory } from "@/lib/conversation-types";

export const runtime = "nodejs";

const CATEGORIES: readonly LongTermMemoryCategory[] = ["profile", "decision", "knowledge"];

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Некорректный JSON в теле запроса." }, { status: 400 });
  }

  const category =
    body && typeof body === "object" && "category" in body ? body.category : null;
  const content =
    body && typeof body === "object" && "content" in body ? body.content : null;

  if (
    typeof category !== "string" ||
    !CATEGORIES.includes(category as LongTermMemoryCategory)
  ) {
    return Response.json(
      { error: "Ожидается category: profile, decision или knowledge." },
      { status: 400 },
    );
  }
  if (typeof content !== "string") {
    return Response.json({ error: "Ожидается строка content." }, { status: 400 });
  }

  try {
    const entry = getConversationStore().addLongTermMemory(
      category as LongTermMemoryCategory,
      content,
    );
    return Response.json({ entry }, { status: 201 });
  } catch (error) {
    if (error instanceof MemoryValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("Не удалось сохранить запись долговременной памяти.", error);
    return Response.json({ error: "Не удалось сохранить запись." }, { status: 500 });
  }
}

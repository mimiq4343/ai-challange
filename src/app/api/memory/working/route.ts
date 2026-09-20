import {
  ConversationNotFoundError,
  MemoryValidationError,
  getConversationStore,
} from "@/lib/conversation-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Некорректный JSON в теле запроса." }, { status: 400 });
  }

  const conversationId =
    body && typeof body === "object" && "conversationId" in body
      ? body.conversationId
      : null;
  const content =
    body && typeof body === "object" && "content" in body ? body.content : null;

  if (typeof conversationId !== "string" || conversationId.length === 0) {
    return Response.json({ error: "Ожидается conversationId." }, { status: 400 });
  }
  if (typeof content !== "string") {
    return Response.json({ error: "Ожидается строка content." }, { status: 400 });
  }

  try {
    const entry = getConversationStore().addWorkingMemory(conversationId, content);
    return Response.json({ entry }, { status: 201 });
  } catch (error) {
    if (error instanceof ConversationNotFoundError) {
      return Response.json({ error: "Диалог не найден." }, { status: 404 });
    }
    if (error instanceof MemoryValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("Не удалось сохранить запись рабочей памяти.", error);
    return Response.json({ error: "Не удалось сохранить запись." }, { status: 500 });
  }
}

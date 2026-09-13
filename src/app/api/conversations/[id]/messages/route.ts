import { ChatAgentError } from "@/lib/chat-agent";
import { ConversationNotFoundError } from "@/lib/conversation-store";
import { PersistentChatAgent } from "@/lib/persistent-chat-agent";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  let content: unknown;

  try {
    ({ content } = await request.json());
  } catch {
    return Response.json({ error: "Некорректный JSON в теле запроса." }, { status: 400 });
  }

  if (typeof content !== "string" || content.trim().length === 0) {
    return Response.json({ error: "Ожидается непустая строка content." }, { status: 400 });
  }

  try {
    const stream = await PersistentChatAgent.fromEnvironment().respond(
      id,
      content.trim(),
      request.signal,
    );
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (error instanceof ConversationNotFoundError) {
      return Response.json({ error: "Диалог не найден." }, { status: 404 });
    }
    if (error instanceof ChatAgentError) {
      return Response.json(
        { error: error.message },
        { status: error.kind === "configuration" ? 500 : 502 },
      );
    }

    console.error(`Не удалось получить ответ для диалога ${id}.`, error);
    return Response.json({ error: "Не удалось получить ответ агента." }, { status: 500 });
  }
}

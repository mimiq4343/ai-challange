import { ChatAgentError } from "@/lib/chat-agent";
import { ConversationNotFoundError } from "@/lib/conversation-store";
import { PersistentChatAgent } from "@/lib/persistent-chat-agent";
import { ContextLimitError } from "@/lib/token-counter";

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
    const response = await PersistentChatAgent.fromEnvironment().respond(
      id,
      content.trim(),
      request.signal,
    );
    return new Response(response.stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Token-System": String(response.preflight.systemTokens),
        "X-Token-History": String(response.preflight.historyTokens),
        "X-Token-Request": String(response.preflight.requestTokens),
        "X-Token-Prompt": String(response.preflight.promptTokens),
        "X-Token-Reserved-Output": String(response.preflight.reservedOutputTokens),
        "X-Token-Context": String(response.preflight.contextTokens),
        "X-Token-Limit": String(response.preflight.contextLimit),
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (error instanceof ConversationNotFoundError) {
      return Response.json({ error: "Диалог не найден." }, { status: 404 });
    }
    if (error instanceof ContextLimitError) {
      const { breakdown } = error;
      return Response.json(
        {
          error: "context_limit",
          limit: breakdown.contextLimit,
          system: breakdown.systemTokens,
          history: breakdown.historyTokens,
          request: breakdown.requestTokens,
          reservedOutput: breakdown.reservedOutputTokens,
          total: breakdown.contextTokens,
          overflow: breakdown.contextTokens - breakdown.contextLimit,
        },
        { status: error.status },
      );
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

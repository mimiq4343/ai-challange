import { ChatAgentError } from "@/lib/chat-agent";
import { ConversationNotFoundError } from "@/lib/conversation-store";
import { memoryResponseHeaders, parseMemoryLayers } from "@/lib/memory-chat-http";
import { PersonalizedChatAgent } from "@/lib/personalized-chat-agent";
import { ContextLimitError } from "@/lib/token-counter";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };


export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Некорректный JSON в теле запроса." }, { status: 400 });
  }

  const content = body.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    return Response.json({ error: "Ожидается непустая строка content." }, { status: 400 });
  }

  const layers = parseMemoryLayers(body.layers);
  if (!layers) {
    return Response.json(
      {
        error:
          "Поле layers должно содержать булевы shortTerm, working, longTerm, profile, task и invariants.",
      },
      { status: 400 },
    );
  }

  try {
    const response = await PersonalizedChatAgent.fromEnvironment({
      taskState: true,
      invariants: true,
    }).respond(
      id,
      content.trim(),
      layers,
      request.signal,
    );

    return new Response(response.stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...memoryResponseHeaders(response),
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

    console.error(`Не удалось получить ответ с инвариантами для ${id}.`, error);
    return Response.json({ error: "Не удалось получить ответ агента." }, { status: 500 });
  }
}

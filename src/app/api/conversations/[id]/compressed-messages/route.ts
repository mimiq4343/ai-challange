import { ChatAgentError } from "@/lib/chat-agent";
import { CompressedChatAgent } from "@/lib/compressed-chat-agent";
import { ConversationNotFoundError } from "@/lib/conversation-store";
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
  if (typeof content !== "string" || !content.trim()) {
    return Response.json({ error: "Ожидается непустая строка content." }, { status: 400 });
  }

  try {
    const { stream, preflight } = await CompressedChatAgent.fromEnvironment().respond(
      id,
      content.trim(),
      request.signal,
    );
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Token-System": String(preflight.compressed.systemTokens),
        "X-Token-History": String(preflight.compressed.historyTokens),
        "X-Token-Request": String(preflight.compressed.requestTokens),
        "X-Token-Prompt": String(preflight.compressed.promptTokens),
        "X-Token-Reserved-Output": String(preflight.compressed.reservedOutputTokens),
        "X-Token-Context": String(preflight.compressed.contextTokens),
        "X-Token-Limit": String(preflight.compressed.contextLimit),
        "X-Compression-Full-History": String(preflight.full.historyTokens),
        "X-Compression-Summary": String(preflight.summaryTokens),
        "X-Compression-Raw-Tail": String(preflight.rawTailTokens),
        "X-Compression-Effective-History": String(
          preflight.summaryTokens + preflight.rawTailTokens,
        ),
        "X-Compression-Saved": String(preflight.grossSavedTokens),
        "X-Compression-Raw-Tail-Messages": String(preflight.rawTailMessageCount),
        "X-Compression-Summarized-Messages": String(
          preflight.summarizedMessageCount,
        ),
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
    console.error(`Не удалось получить сжатый ответ для диалога ${id}.`, error);
    return Response.json({ error: "Не удалось получить ответ агента." }, { status: 500 });
  }
}

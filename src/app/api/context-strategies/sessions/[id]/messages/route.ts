import { ChatAgentError } from "@/lib/chat-agent";
import { ContextStrategyAgent } from "@/lib/context-strategy-agent";
import {
  ContextSessionNotFoundError,
  ContextStrategyStateError,
} from "@/lib/context-strategy-store";
import { ContextLimitError } from "@/lib/token-counter";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  let content: unknown;
  try {
    ({ content } = await request.json());
  } catch {
    return Response.json({ error: "Некорректный JSON." }, { status: 400 });
  }
  if (typeof content !== "string" || !content.trim()) {
    return Response.json({ error: "Ожидается непустая строка content." }, { status: 400 });
  }

  try {
    const result = await ContextStrategyAgent.fromEnvironment().respond(
      id,
      content.trim(),
      request.signal,
    );
    return new Response(result.stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Token-Prompt": String(result.preflight.promptTokens),
        "X-Token-History": String(result.preflight.historyTokens),
        "X-Facts-Overhead": String(result.factsOverheadTokens),
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (error instanceof ContextSessionNotFoundError) {
      return Response.json({ error: "Сессия не найдена." }, { status: 404 });
    }
    if (error instanceof ContextStrategyStateError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof ContextLimitError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    if (error instanceof ChatAgentError || error instanceof TypeError) {
      return Response.json({ error: error.message }, { status: 502 });
    }
    console.error(`Не удалось выполнить Day 10 session ${id}.`, error);
    return Response.json({ error: "Не удалось получить ответ агента." }, { status: 500 });
  }
}

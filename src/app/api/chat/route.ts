import { NextRequest } from "next/server";
import { ChatAgent, ChatAgentError, type ChatMessage } from "@/lib/chat-agent";

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  return (
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string"
  );
}

export async function POST(request: NextRequest) {
  let messages: unknown;
  try {
    ({ messages } = await request.json());
  } catch {
    return Response.json({ error: "Некорректный JSON в теле запроса." }, { status: 400 });
  }

  if (!Array.isArray(messages) || messages.length === 0 || !messages.every(isChatMessage)) {
    return Response.json(
      { error: "Ожидается непустой массив messages с ролями user/assistant." },
      { status: 400 },
    );
  }

  try {
    const agent = ChatAgent.fromEnvironment();
    const response = await agent.respond(messages, request.signal);

    return new Response(response.stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (error instanceof ChatAgentError) {
      return Response.json(
        { error: error.message },
        { status: error.kind === "configuration" ? 500 : 502 },
      );
    }
    throw error;
  }
}

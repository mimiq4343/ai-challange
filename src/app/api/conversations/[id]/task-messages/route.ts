import { ChatAgentError } from "@/lib/chat-agent";
import { ConversationNotFoundError } from "@/lib/conversation-store";
import { ALL_MEMORY_LAYERS_ENABLED, type MemoryLayerToggles } from "@/lib/memory-types";
import { PersonalizedChatAgent } from "@/lib/personalized-chat-agent";
import { ContextLimitError } from "@/lib/token-counter";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function parseLayers(value: unknown): MemoryLayerToggles | null {
  if (value === undefined) return ALL_MEMORY_LAYERS_ENABLED;
  if (typeof value !== "object" || value === null) return null;

  const candidate = value as Record<string, unknown>;
  const toggles = ["shortTerm", "working", "longTerm", "profile", "task"] as const;
  if (toggles.some((name) => typeof candidate[name] !== "boolean")) return null;

  return {
    shortTerm: candidate.shortTerm as boolean,
    working: candidate.working as boolean,
    longTerm: candidate.longTerm as boolean,
    profile: candidate.profile as boolean,
    task: candidate.task as boolean,
  };
}

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

  const layers = parseLayers(body.layers);
  if (!layers) {
    return Response.json(
      {
        error:
          "Поле layers должно содержать булевы shortTerm, working, longTerm, profile и task.",
      },
      { status: 400 },
    );
  }

  try {
    const response = await PersonalizedChatAgent.fromEnvironment({
      taskState: true,
    }).respond(
      id,
      content.trim(),
      layers,
      request.signal,
    );
    const { layerTokens } = response;

    return new Response(response.stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Token-System": String(layerTokens.systemTokens),
        "X-Token-History": String(layerTokens.shortTermTokens),
        "X-Token-Request": String(layerTokens.requestTokens),
        "X-Token-Prompt": String(layerTokens.promptTokens),
        "X-Token-Reserved-Output": String(layerTokens.reservedOutputTokens),
        "X-Token-Context": String(layerTokens.contextTokens),
        "X-Token-Limit": String(layerTokens.contextLimit),
        "X-Memory-Ltm": String(layerTokens.longTermTokens),
        "X-Memory-Wm": String(layerTokens.workingTokens),
        "X-Memory-Stm": String(layerTokens.shortTermTokens),
        "X-Memory-Prof": String(layerTokens.profileTokens),
        "X-Memory-Task": String(layerTokens.taskTokens),
        "X-Memory-Stm-Messages": String(response.shortTermMessages),
        "X-Memory-Profile": String(response.profile.id),
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

    console.error(`Не удалось получить ответ с состоянием задачи для ${id}.`, error);
    return Response.json({ error: "Не удалось получить ответ агента." }, { status: 500 });
  }
}

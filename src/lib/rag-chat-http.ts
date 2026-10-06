import "server-only";
import { ConversationNotFoundError } from "./conversation-store";
import { RagError } from "./rag-agent";
import { RAG_CONFIG } from "./rag-config";
import { RagChatAgent } from "./rag-chat-agent";
import { parseRefinementSettings } from "./rag-refinement-agent";
import { failure, readPayload } from "./rag-refinement-http";

export async function ragChatResponse(request: Request, conversationId: string, createAgent: () => RagChatAgent = RagChatAgent.fromEnvironment): Promise<Response> {
  try {
    const { content, settings, ...extra } = await readPayload(request);
    if (Object.keys(extra).length || typeof content !== "string" || !content.trim() || content.trim().length > RAG_CONFIG.maxQuestionCharacters) throw new RagError("Нужны только content и settings; вопрос — непустая строка до 4000 символов.", 400);
    const parsedSettings = parseRefinementSettings(settings);
    request.signal.throwIfAborted();
    const detail = await createAgent().respond(conversationId, content, parsedSettings, request.signal);
    return Response.json({ detail }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ConversationNotFoundError) return Response.json({ error: "Диалог не найден." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return failure(error, request, "rag_chat_failed");
  }
}

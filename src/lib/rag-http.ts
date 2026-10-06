import "server-only";
import { ChatAgentError } from "./chat-agent";
import { RagAgent, RagError } from "./rag-agent";
import { RAG_CONFIG } from "./rag-config";
import type { RagAnswer, RagMode, RagRequestMode } from "./rag-types";

const headers = { "Cache-Control": "no-store" };

export async function ragResponse(request: Request, createAgent: (mode: RagRequestMode) => RagAgent = RagAgent.fromEnvironment): Promise<Response> {
  let payload: unknown;
  try {
    if (!request.body) return Response.json({ error: "Нужен JSON с question и mode." }, { status: 400, headers });
    const reader = request.body.getReader();
    const parts: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > RAG_CONFIG.maxRequestBytes) {
          await reader.cancel();
          return Response.json({ error: "Запрос превышает допустимый объём." }, { status: 413, headers });
        }
        parts.push(part.value);
      }
    } finally { reader.releaseLock(); }
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts)));
  } catch {
    return Response.json({ error: "Недействительный JSON запроса." }, { status: 400, headers });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return Response.json({ error: "Нужны question и mode." }, { status: 400, headers });
  const { question, mode } = payload as Record<string, unknown>;
  if (typeof question !== "string" || !question.trim() || question.trim().length > RAG_CONFIG.maxQuestionCharacters ||
    (mode !== "plain" && mode !== "rag" && mode !== "compare") || Object.keys(payload).some((key) => key !== "question" && key !== "mode")) {
    return Response.json({ error: `Укажите question (1–${RAG_CONFIG.maxQuestionCharacters} символов) и mode=plain|rag|compare.` }, { status: 400, headers });
  }
  try {
    const agent = createAgent(mode);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(RAG_CONFIG.comparisonTimeoutMs)]);
    const answers: RagAnswer[] = [];
    const modes: readonly RagMode[] = mode === "compare" ? ["plain", "rag"] : [mode];
    for (const selected of modes) {
      answers.push(await agent.respond(question, selected, signal));
    }
    return Response.json({ question: question.trim(), answers }, { headers });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499, headers });
    if (error instanceof RagError) return Response.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof ChatAgentError && error.kind === "configuration") return Response.json({ error: error.message }, { status: 503, headers });
    console.error({ event: "rag_request_failed", mode, errorName: error instanceof Error ? error.name : "UnknownError" });
    return Response.json({ error: "Не удалось получить полный ответ LLM: ошибка сервиса, таймаут или повреждённый поток." }, { status: 502, headers });
  }
}

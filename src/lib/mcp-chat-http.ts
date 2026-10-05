import { ChatAgentError } from "./chat-agent";
import { getConversationStore } from "./conversation-store";
import { memoryResponseHeaders, parseMemoryLayers } from "./memory-chat-http";
import { readMcpObjectBody, validateMcpMutation } from "./mcp-api";
import type { McpChatEvent, McpToolEvent } from "./mcp-chat-types";
import { McpConnectionError } from "./mcp-client";
import { MCP_PUBLIC_URL } from "./mcp-config";
import { getMcpServerStore } from "./mcp-store";
import { McpToolChatAgent } from "./mcp-tool-chat-agent";
import { getOrchestrationStore } from "./orchestration-run-store";
import { PersonalizedChatAgent } from "./personalized-chat-agent";
import { getProfileStore } from "./profile-store";
import { SCHEDULER_MCP_URL } from "./scheduler-config";
import { PIPELINE_MCP_URL } from "./pipeline-config";
import { ContextLimitError } from "./token-counter";

export type McpRouteContext = { params: Promise<{ id: string }> };

export type McpChatMode = "repository" | "scheduler" | "pipeline" | "orchestration";

const PRESERVED_ON_ERROR: Partial<Record<McpChatMode, string>> = {
  scheduler: "Уже выполненные операции с расписаниями сохраняются. Проверьте список заданий перед повтором.",
  pipeline: "Уже сохранённые файлы остаются в списке отчётов.",
  orchestration: "Уже выполненные шаги на серверах (созданный мониторинг, сохранённые файлы) сохраняются. Проверьте маршрут в панели перед повтором.",
};

export async function handleMcpChat(request: Request, context: McpRouteContext, mode: McpChatMode = "repository") {
  const rejected = validateMcpMutation(request);
  if (rejected) return rejected;
  const body = await readMcpObjectBody(request);
  if (body instanceof Response) return body;
  if (typeof body.content !== "string" || !body.content.trim()) {
    return Response.json({ error: "Ожидается непустая строка content." }, { status: 400 });
  }
  const content = body.content.trim();
  const layers = parseMemoryLayers(body.layers);
  if (!layers) {
    return Response.json({ error: "Некорректные переключатели слоёв памяти." }, { status: 400 });
  }
  const { id } = await context.params;
  if (!getConversationStore().getConversation(id)) {
    return Response.json({ error: "Диалог не найден." }, { status: 404 });
  }
  const profile = getProfileStore().getActiveProfile();
  if (mode === "repository" && !getMcpServerStore().listServers(profile.id).some(({ url }) => url === MCP_PUBLIC_URL)) {
    return Response.json(
      { error: `Добавьте MCP-сервер ${MCP_PUBLIC_URL} в панели агента.` },
      { status: 409 },
    );
  }

  const abort = new AbortController();
  const signal = AbortSignal.any([request.signal, abort.signal]);
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: McpChatEvent) => {
        if (!closed && !signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      const run = async () => {
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        const journal = mode === "orchestration" ? getOrchestrationStore() : null;
        let runId: string | undefined;
        try {
          signal.throwIfAborted();
          runId = journal?.startRun(profile.id, id, content);
          const onToolEvent = (event: McpToolEvent) => {
            if (journal && runId) {
              if (event.type === "tool-result") journal.finishCall(runId, event.callId, event.result.isError);
              else if (event.server) journal.startCall(runId, event.callId, event.server.id, event.name, event.arguments);
              else throw new Error("Вызов оркестрации без сервера маршрута.");
            }
            send(event);
          };
          const llm = McpToolChatAgent.fromEnvironment(mode === "orchestration"
            ? {
              onToolEvent,
              onServers: (statuses) => { if (journal && runId) journal.setServers(runId, statuses); },
              access: { kind: mode, profileId: profile.id },
            }
            : {
              endpoint: mode === "pipeline" ? PIPELINE_MCP_URL : mode === "scheduler" ? SCHEDULER_MCP_URL : MCP_PUBLIC_URL,
              onToolEvent,
              access: mode === "repository" ? { kind: mode } : { kind: mode, profileId: profile.id },
            });
          const agent = PersonalizedChatAgent.fromEnvironment({ taskState: true, invariants: true }, llm);
          // Guard применяется до LLM/MCP во всех режимах, включая пайплайн и оркестрацию.
          const response = await agent.respond(id, content, layers, signal);
          send({ type: "metadata", headers: memoryResponseHeaders(response) });
          reader = response.stream.getReader();
          const decoder = new TextDecoder();
          for (;;) {
            signal.throwIfAborted();
            const { done, value } = await reader.read();
            if (done) break;
            const delta = decoder.decode(value, { stream: true });
            if (delta) send({ type: "text", delta });
          }
          const delta = decoder.decode();
          if (delta) send({ type: "text", delta });
          signal.throwIfAborted();
          if (journal && runId) journal.finishRun(runId, { status: "completed" });
          // EOF наступает только после сохранения полного обмена агентом.
          send({ type: "done" });
        } catch (error) {
          const expected = error instanceof ChatAgentError || error instanceof McpConnectionError || error instanceof ContextLimitError;
          const message = expected ? error.message : "Не удалось завершить ответ агента с MCP.";
          if (journal && runId) {
            try {
              journal.finishRun(runId, { status: "failed", error: signal.aborted ? "Запуск отменён." : message });
            } catch (journalError) {
              console.error("Не удалось записать итог запуска оркестрации.", { conversationId: id, error: journalError instanceof Error ? journalError.name : "UnknownError" });
            }
          }
          if (!signal.aborted) {
            if (!expected) console.error("Ошибка MCP-чата.", { conversationId: id, error: error instanceof Error ? error.name : "UnknownError" });
            const preserved = PRESERVED_ON_ERROR[mode];
            send({ type: "error", message: preserved ? `${message} ${preserved}` : message });
          }
          abort.abort(error);
        } finally {
          reader?.releaseLock();
          if (!closed) {
            closed = true;
            controller.close();
          }
        }
      };
      void run();
    },
    cancel(reason) {
      closed = true;
      abort.abort(reason);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

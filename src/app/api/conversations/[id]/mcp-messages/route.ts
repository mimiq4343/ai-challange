import { ChatAgentError } from "@/lib/chat-agent";
import { getConversationStore } from "@/lib/conversation-store";
import { memoryResponseHeaders, parseMemoryLayers } from "@/lib/memory-chat-http";
import { readMcpObjectBody, validateMcpMutation } from "@/lib/mcp-api";
import type { McpChatEvent } from "@/lib/mcp-chat-types";
import { McpConnectionError } from "@/lib/mcp-client";
import { MCP_PUBLIC_URL } from "@/lib/mcp-config";
import { getMcpServerStore } from "@/lib/mcp-store";
import { McpToolChatAgent } from "@/lib/mcp-tool-chat-agent";
import { PersonalizedChatAgent } from "@/lib/personalized-chat-agent";
import { getProfileStore } from "@/lib/profile-store";
import { ContextLimitError } from "@/lib/token-counter";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
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
  const server = getMcpServerStore().listServers(profile.id).find(({ url }) => url === MCP_PUBLIC_URL);
  if (!server) {
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
        try {
          signal.throwIfAborted();
          const llm = McpToolChatAgent.fromEnvironment({ endpoint: server.url, onToolEvent: send });
          const agent = PersonalizedChatAgent.fromEnvironment({ taskState: true, invariants: true }, llm);
          // respond сначала применяет guard, затем вызывает LLM и MCP.
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
          // EOF наступает только после сохранения полного обмена агентом.
          send({ type: "done" });
        } catch (error) {
          if (!signal.aborted) {
            const expected = error instanceof ChatAgentError || error instanceof McpConnectionError || error instanceof ContextLimitError;
            if (!expected) console.error("Ошибка MCP-чата.", { conversationId: id, error });
            send({ type: "error", message: expected ? error.message : "Не удалось завершить ответ агента с MCP." });
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

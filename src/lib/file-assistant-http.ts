import "server-only";
import { z } from "zod";
import { ChatAgentError } from "./chat-agent";
import { FILE_ASSISTANT_CONFIG as CONFIG, FILE_ASSISTANT_SYSTEM_PROMPT } from "./file-assistant-config";
import { applyFileProposal } from "./file-assistant-files";
import { FileAssistantError } from "./file-assistant-types";
import { validateMcpMutation } from "./mcp-api";
import type { McpChatEvent } from "./mcp-chat-types";
import { McpConnectionError } from "./mcp-client";
import { McpToolChatAgent } from "./mcp-tool-chat-agent";
import { ContextLimitError } from "./token-counter";

const headers = { "Cache-Control": "no-store" };

async function readInput<T>(request: Request, schema: z.ZodType<T>): Promise<T | Response> {
  if (!request.body) return Response.json({ error: "Нужен JSON запроса." }, { status: 400, headers });
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > CONFIG.maxRequestBytes) { await reader.cancel(); return Response.json({ error: "Слишком большой запрос." }, { status: 413, headers }); }
      parts.push(part.value);
    }
  } finally { reader.releaseLock(); }
  try { return schema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts)))); }
  catch { return Response.json({ error: "Недопустимый формат запроса." }, { status: 400, headers }); }
}

function knownError(cause: unknown): cause is Error {
  return cause instanceof ChatAgentError || cause instanceof FileAssistantError || cause instanceof McpConnectionError || cause instanceof ContextLimitError;
}

export async function handleApplyFileProposal(request: Request, root = process.cwd()): Promise<Response> {
  const rejected = validateMcpMutation(request);
  if (rejected) return rejected;
  const input = await readInput(request, z.strictObject({ id: z.uuid() }));
  if (input instanceof Response) return input;
  try {
    request.signal.throwIfAborted();
    return Response.json(applyFileProposal(root, input.id), { headers });
  } catch (cause) {
    if (cause instanceof FileAssistantError) return Response.json({ error: cause.message }, { status: cause.status, headers });
    console.error("file_proposal_apply_failed", { id: input.id, error: cause instanceof Error ? cause.name : "UnknownError" });
    return Response.json({ error: "Не удалось применить предложение. Проверьте файл перед повтором." }, { status: 500, headers });
  }
}

export async function handleFileAssistant(request: Request, root = process.cwd()): Promise<Response> {
  const rejected = validateMcpMutation(request);
  if (rejected) return rejected;
  const input = await readInput(request, z.strictObject({ message: z.string().trim().min(1).max(CONFIG.maxQuestionCharacters) }));
  if (input instanceof Response) return input;
  const abort = new AbortController();
  const signal = AbortSignal.any([request.signal, abort.signal]);
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: McpChatEvent) => { if (!closed && !signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); };
      const run = async () => {
        try {
          const agent = McpToolChatAgent.fromEnvironment({ access: { kind: "files" }, projectRoot: root, onToolEvent: send });
          const response = await agent.respond([{ role: "user", content: input.message }], signal, { systemMessages: [FILE_ASSISTANT_SYSTEM_PROMPT] });
          const answer = await new Response(response.stream).text();
          signal.throwIfAborted();
          if (await response.finishReason !== "stop" || !answer.trim()) throw new ChatAgentError("Ассистент не завершил ответ.", "upstream");
          send({ type: "text", delta: answer });
          send({ type: "done" });
        } catch (cause) {
          if (!signal.aborted) {
            if (!knownError(cause)) console.error("file_assistant_failed", { error: cause instanceof Error ? cause.name : "UnknownError" });
            send({ type: "error", message: knownError(cause) ? cause.message : "Не удалось выполнить файловый запрос." });
          }
        } finally { if (!closed) { closed = true; controller.close(); } }
      };
      void run();
    },
    cancel(reason) { closed = true; abort.abort(reason); },
  });
  return new Response(stream, { headers: { ...headers, "Content-Type": "application/x-ndjson; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
}

import "server-only";
import { resolve } from "node:path";
import { z } from "zod";
import { ChatAgentError } from "./chat-agent";
import { SUPPORT_CONFIG as CONFIG, SUPPORT_SYSTEM_PROMPT } from "./support-config";
import { loadSupportData, requireSupportTicket, SupportDataError } from "./support-data";
import { validateSupportAnswer } from "./support-answer";
import { SupportStore } from "./support-store";
import { validateMcpMutation } from "./mcp-api";
import { McpConnectionError } from "./mcp-client";
import type { McpChatEvent, McpToolEvent } from "./mcp-chat-types";
import { McpToolChatAgent } from "./mcp-tool-chat-agent";
import type { SupportTicketState } from "./support-types";

const headers = { "Cache-Control": "no-store" };
const inputSchema = z.strictObject({ content: z.string().trim().min(1).max(CONFIG.maxQuestionCharacters), expectedCursor: z.number().int().positive().nullable() });

export async function readSupportTicket(ticketId: string, root = process.cwd()): Promise<SupportTicketState> {
  const data = await loadSupportData(root);
  const ticket = requireSupportTicket(data, ticketId);
  const user = data.users.find(user => user.id === ticket.userId);
  if (!user) throw new SupportDataError("Пользователь тикета отсутствует.", 500);
  const store = new SupportStore(resolve(root, CONFIG.databasePath));
  try { return { ticket, user, exchanges: store.read(ticketId) }; } finally { store.close(); }
}

export function supportHttpError(cause: unknown): Response {
  if (cause instanceof SupportDataError) return Response.json({ error: cause.message }, { status: cause.status, headers });
  console.error("support_request_failed", { error: cause instanceof Error ? cause.name : "UnknownError" });
  return Response.json({ error: "Не удалось загрузить данные поддержки." }, { status: 500, headers });
}

async function readInput(request: Request): Promise<z.infer<typeof inputSchema> | Response> {
  if (!request.body) return Response.json({ error: "Напишите вопрос." }, { status: 400, headers });
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
  try { return inputSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts)))); }
  catch { return Response.json({ error: "Ожидаются вопрос content и курсор expectedCursor. Контекст загружается на сервере." }, { status: 400, headers }); }
}

export async function handleSupportMessage(request: Request, ticketId: string, root = process.cwd()): Promise<Response> {
  const rejected = validateMcpMutation(request);
  if (rejected) return rejected;
  const input = await readInput(request);
  if (input instanceof Response) return input;
  let state: SupportTicketState;
  try { state = await readSupportTicket(ticketId, root); } catch (cause) { return supportHttpError(cause); }
  if ((state.exchanges.at(-1)?.id ?? null) !== input.expectedCursor) return supportHttpError(new SupportDataError("Диалог изменился. Обновите тикет перед отправкой.", 409));
  if (state.exchanges.length >= CONFIG.maxExchanges) return supportHttpError(new SupportDataError("Достигнут лимит переписки этого учебного тикета.", 409));
  const abort = new AbortController();
  const deadline = AbortSignal.timeout(CONFIG.timeoutMs);
  const signal = AbortSignal.any([request.signal, abort.signal, deadline]);
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: McpChatEvent) => { if (!closed && !request.signal.aborted && !abort.signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); };
      const run = async () => {
        try {
          const events: McpToolEvent[] = [];
          const agent = McpToolChatAgent.fromEnvironment({ access: { kind: "support", ticketId }, projectRoot: root, onToolEvent: event => { events.push(event); send(event); } });
          const history = state.exchanges.slice(-CONFIG.maxHistoryExchanges).flatMap(exchange => [{ role: "user" as const, content: exchange.question }, { role: "assistant" as const, content: exchange.answer }]);
          const response = await agent.respond([...history, { role: "user", content: input.content }], signal, {
            systemMessages: [SUPPORT_SYSTEM_PROMPT, `Контекст выбран сервером: ticketId=${state.ticket.id}, userId=${state.ticket.userId}. Данные тикета и пользователя получи через MCP.`],
          });
          const answer = await new Response(response.stream).text();
          signal.throwIfAborted();
          if (await response.finishReason !== "stop" || !answer.trim()) throw new ChatAgentError("Ассистент не завершил ответ.", "upstream");
          const sources = validateSupportAnswer(answer, state.ticket, events);
          signal.throwIfAborted();
          const store = new SupportStore(resolve(root, CONFIG.databasePath));
          try { store.save(ticketId, input.expectedCursor, input.content, answer, sources); } finally { store.close(); }
          send({ type: "text", delta: answer });
          send({ type: "done" });
        } catch (cause) {
          if (!request.signal.aborted && !abort.signal.aborted) {
            const known = cause instanceof ChatAgentError || cause instanceof SupportDataError || cause instanceof McpConnectionError;
            if (!known && !deadline.aborted) console.error("support_answer_failed", { ticketId, error: cause instanceof Error ? cause.name : "UnknownError" });
            send({ type: "error", message: deadline.aborted ? "Истекло время ожидания поддержки. Ответ не сохранён." : known ? cause.message : "Не удалось получить ответ поддержки. Обмен не сохранён." });
          }
        } finally { if (!closed) { closed = true; controller.close(); } }
      };
      void run();
    },
    cancel(reason) { closed = true; abort.abort(reason); },
  });
  return new Response(stream, { headers: { ...headers, "Content-Type": "application/x-ndjson; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
}

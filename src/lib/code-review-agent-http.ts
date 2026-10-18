import "server-only";
import { z } from "zod";
import { ChatAgentError } from "./chat-agent";
import { CODE_REVIEW_AGENT_LIMITS as LIMITS } from "./code-review-agent-config";
import { CODE_REVIEW_CONFIG } from "./code-review-config";
import { readReviewWorkspace } from "./code-review-git";
import { validateMcpMutation } from "./mcp-api";
import type { McpChatEvent } from "./mcp-chat-types";
import { McpToolChatAgent } from "./mcp-tool-chat-agent";

const inputSchema = z.strictObject({ message: z.string().trim().min(1).max(LIMITS.maxQuestionCharacters), baseRef: z.string().min(1).max(300), headRef: z.string().min(1).max(300) });
const headers = { "Cache-Control": "no-store" };

async function readInput(request: Request): Promise<z.infer<typeof inputSchema> | Response> {
  if (!request.body) return Response.json({ error: "Напишите запрос и выберите ветки." }, { status: 400, headers });
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > LIMITS.maxRequestBytes) { await reader.cancel(); return Response.json({ error: "Запрос превышает допустимый объём." }, { status: 413, headers }); }
      parts.push(part.value);
    }
  } finally { reader.releaseLock(); }
  try { return inputSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts)))); }
  catch { return Response.json({ error: "Ожидаются message, baseRef и headRef из списка веток." }, { status: 400, headers }); }
}

export async function handleReviewAgent(request: Request, root = process.cwd()): Promise<Response> {
  const rejected = validateMcpMutation(request);
  if (rejected) return rejected;
  const input = await readInput(request);
  if (input instanceof Response) return input;
  let workspace;
  try { workspace = await readReviewWorkspace(root, request.signal); }
  catch (cause) {
    if (request.signal.aborted) return new Response(null, { status: 499, headers });
    console.error("code_review_agent_refs_failed", { error: cause instanceof Error ? cause.name : "UnknownError" });
    return Response.json({ error: "Не удалось прочитать ветки проекта на сервере." }, { status: 502, headers });
  }
  if (![input.baseRef, input.headRef].every(ref => workspace.branches.some(branch => branch.ref === ref))) {
    return Response.json({ error: "Ветка не найдена. Обновите список веток." }, { status: 400, headers });
  }
  // URL другого проекта нельзя незаметно превратить в номер PR текущего проекта.
  const urls = input.message.matchAll(/https?:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/\d+/gi);
  if ([...urls].some(match => match[1].toLowerCase() !== workspace.repository.toLowerCase())) {
    return Response.json({ error: "Ревью доступно только для репозитория проекта." }, { status: 400, headers });
  }
  const context = { workspace, selection: { baseRef: input.baseRef, headRef: input.headRef } };
  const abort = new AbortController();
  const deadline = AbortSignal.timeout(LIMITS.timeoutMs);
  const signal = AbortSignal.any([request.signal, abort.signal, deadline]);
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: McpChatEvent) => { if (!closed && !request.signal.aborted && !abort.signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); };
      const run = async () => {
        try {
          const agent = McpToolChatAgent.fromEnvironment({ access: { kind: "review" }, projectRoot: root, onToolEvent: send,
            review: { context, onEvent: event => send({ type: "review", repository: workspace.repository, event }) },
          }, { ...process.env, OPENAI_MODEL: CODE_REVIEW_CONFIG.model });
          const response = await agent.respond([{ role: "user", content: input.message }], signal, {
            systemMessages: [`PROJECT_CONTEXT\n${JSON.stringify(context)}`], maxOutputTokens: LIMITS.maxOutputTokens,
          });
          const answer = await new Response(response.stream).text();
          signal.throwIfAborted();
          if (await response.finishReason !== "stop" || !answer.trim()) throw new ChatAgentError("Агент не завершил ответ. Готовый отчёт, если он есть, остаётся в интерфейсе.", "upstream");
          send({ type: "text", delta: answer });
          send({ type: "done" });
        } catch (cause) {
          if (!request.signal.aborted && !abort.signal.aborted) {
            const known = cause instanceof ChatAgentError;
            if (!known && !deadline.aborted) console.error("code_review_agent_failed", { error: cause instanceof Error ? cause.name : "UnknownError" });
            send({ type: "error", message: deadline.aborted ? "Истёк таймаут ревью. Попробуйте меньшее изменение." : known ? cause.message : "Не удалось выполнить запрос агента ревью." });
          }
        } finally { if (!closed) { closed = true; controller.close(); } }
      };
      void run();
    },
    cancel(reason) { closed = true; abort.abort(reason); },
  });
  return new Response(stream, { headers: { ...headers, "Content-Type": "application/x-ndjson; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
}

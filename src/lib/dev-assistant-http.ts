import "server-only";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ChatAgentError } from "./chat-agent";
import { DEV_ASSISTANT_LIMITS as LIMITS, DEV_ASSISTANT_SYSTEM_PROMPT } from "./dev-assistant-config";
import { validateMcpMutation } from "./mcp-api";
import type { McpChatEvent, McpToolResult } from "./mcp-chat-types";
import { McpConnectionError } from "./mcp-client";
import { McpToolChatAgent } from "./mcp-tool-chat-agent";
import { withProjectMcpTools } from "./project-mcp-client";
import { projectToolOutputSchemas, type ProjectToolOutput } from "./project-tool-schemas";
import { ContextLimitError } from "./token-counter";

const headers = { "Cache-Control": "no-store" };
const HELP_COMMAND = /^\/help(?:\s+([\s\S]*))?$/;

/** Разбирает команду ассистента; пустой вопрос означает справку о самом ассистенте. */
export function parseHelpCommand(command: unknown): { question: string } | { error: string } {
  if (typeof command !== "string") return { error: "Ожидается строка command." };
  const match = HELP_COMMAND.exec(command.trim());
  if (!match) return { error: "Неизвестная команда. Используйте /help <вопрос о проекте>." };
  const question = (match[1] ?? "").trim();
  if (question.length > LIMITS.maxQuestionCharacters) return { error: `Вопрос длиннее ${LIMITS.maxQuestionCharacters} символов.` };
  return { question };
}

async function readCommand(request: Request): Promise<string | Response> {
  if (!request.body) return Response.json({ error: "Нужен JSON с полем command." }, { status: 400, headers });
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > LIMITS.maxRequestBytes) {
        await reader.cancel();
        return Response.json({ error: "Запрос превышает допустимый объём." }, { status: 413, headers });
      }
      parts.push(part.value);
    }
  } finally { reader.releaseLock(); }
  let payload: unknown;
  try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts))); }
  catch { return Response.json({ error: "Недействительный JSON запроса." }, { status: 400, headers }); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).some((key) => key !== "command")) {
    return Response.json({ error: "Тело запроса должно содержать только поле command." }, { status: 400, headers });
  }
  const { command } = payload as Record<string, unknown>;
  return typeof command === "string" ? command : Response.json({ error: "Ожидается строка command." }, { status: 400, headers });
}

function toolResult(raw: CallToolResult): McpToolResult {
  return {
    content: raw.content.map((part) => {
      if (part.type !== "text") throw new McpConnectionError("MCP-сервер проекта вернул неподдерживаемый тип содержимого.", 502);
      return { type: "text", text: part.text };
    }),
    ...(raw.structuredContent ? { structuredContent: raw.structuredContent } : {}),
    isError: raw.isError === true,
  };
}

/** Текущая ветка через MCP-инструмент git_branch. */
export async function readProjectBranch(signal: AbortSignal, onResult?: (result: McpToolResult) => void): Promise<ProjectToolOutput<"git_branch">> {
  return withProjectMcpTools(signal, async (session) => {
    const result = toolResult(await session.callTool("git_branch", {}));
    onResult?.(result);
    const parsed = projectToolOutputSchemas.git_branch.safeParse(result.structuredContent);
    if (result.isError || !parsed.success) {
      throw new McpConnectionError(result.content.map(({ text }) => text).join("\n") || "git_branch не вернул ветку.", 502);
    }
    return parsed.data;
  });
}

function helpOverview(branch: ProjectToolOutput<"git_branch">): string {
  const where = branch.branch ? `ветка \`${branch.branch}\`` : "detached HEAD";
  return [
    `**Flash Dev — ассистент разработчика.** Сейчас ${where}${branch.head ? `, HEAD \`${branch.head}\`` : ""}.`,
    "",
    "Спросите командой `/help <вопрос о проекте>`. Модель сама выбирает MCP-инструменты проекта:",
    "",
    "- `search_docs` — поиск по README.md, AGENTS.md, docs/ и SQL-схемам; ответ ссылается на найденные фрагменты;",
    "- `git_branch` и `git_status` — ветка, HEAD и изменённые файлы;",
    "- `list_files` — структура каталогов по отслеживаемым файлам;",
    "- `git_diff` — изменения рабочего дерева относительно HEAD.",
    "",
    "Например: `/help Как устроен проект и где лежат API-маршруты?`",
  ].join("\n");
}

export async function handleHelpCommand(request: Request): Promise<Response> {
  const rejected = validateMcpMutation(request);
  if (rejected) return rejected;
  const command = await readCommand(request);
  if (command instanceof Response) return command;
  const parsed = parseHelpCommand(command);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400, headers });

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
        try {
          if (!parsed.question) {
            const callId = "help-git-branch";
            send({ type: "tool-start", callId, name: "git_branch", arguments: {} });
            const branch = await readProjectBranch(signal, (result) => send({ type: "tool-result", callId, result }));
            send({ type: "text", delta: helpOverview(branch) });
          } else {
            const llm = McpToolChatAgent.fromEnvironment({ onToolEvent: send, access: { kind: "project" } });
            const response = await llm.respond([{ role: "user", content: parsed.question }], signal, { systemMessages: [DEV_ASSISTANT_SYSTEM_PROMPT] });
            const answer = await new Response(response.stream).text();
            signal.throwIfAborted();
            if (await response.finishReason !== "stop" || !answer.trim()) throw new ChatAgentError("Модель не завершила ответ.", "upstream");
            send({ type: "text", delta: answer });
          }
          send({ type: "done" });
        } catch (error) {
          const expected = error instanceof ChatAgentError || error instanceof McpConnectionError || error instanceof ContextLimitError;
          if (!signal.aborted) {
            if (!expected) console.error("dev_assistant_failed", { error: error instanceof Error ? error.name : "UnknownError" });
            send({ type: "error", message: expected ? error.message : "Не удалось получить ответ ассистента разработчика." });
          }
          abort.abort(error);
        } finally {
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
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

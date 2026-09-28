import { z } from "zod";

import type { McpChatEvent } from "./mcp-chat-types";

const mcpChatEventSchema: z.ZodType<McpChatEvent> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("done") }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({ type: z.literal("text"), delta: z.string() }),
  z.object({ type: z.literal("metadata"), headers: z.record(z.string(), z.string()) }),
  z.object({
    type: z.literal("tool-start"),
    callId: z.string(),
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()),
    server: z.object({ id: z.string(), name: z.string() }).optional(),
  }),
  z.object({
    type: z.literal("tool-result"),
    callId: z.string(),
    result: z.object({
      content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
      structuredContent: z.record(z.string(), z.unknown()).optional(),
      isError: z.boolean(),
    }),
  }),
]);

function parseEvent(line: string): McpChatEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error("Некорректное событие в ответе MCP. Попробуйте отправить сообщение ещё раз.");
  }
  const parsed = mcpChatEventSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Некорректное событие в ответе MCP. Попробуйте отправить сообщение ещё раз.");
  }
  return parsed.data;
}

/** Обмен успешен только после done: закрытие HTTP-потока не подтверждает сохранение. */
export async function consumeMcpChatStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: McpChatEvent) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  function dispatch(line: string): boolean {
    if (!line.trim()) return false;
    const event = parseEvent(line);
    if (event.type === "error") throw new Error(event.message);
    onEvent(event);
    return event.type === "done";
  }

  try {
    for (;;) {
      const { done, value } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (dispatch(line)) return;
      }
      if (done) {
        if (pending && dispatch(pending)) return;
        throw new Error("Ответ оборвался до подтверждения сохранения. Обновите диалог и попробуйте ещё раз.");
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

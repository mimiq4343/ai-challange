import { ChatAgentError, parseProviderUsage } from "./chat-agent";
import type { ProviderTokenUsage } from "./conversation-types";
import { MCP_TOOL_CHAT_LIMITS as LIMITS } from "./mcp-config";

export type ProviderToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ProviderToolRound = {
  content: string;
  reasoning_content: string;
  tool_calls: ProviderToolCall[];
  usage: ProviderTokenUsage | null;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Общий текстовый адаптер Day 8 намеренно терпим к повреждённым SSE-строкам.
// Здесь нельзя исполнять частичный tool_call или сохранять усечённый ответ.
export async function readMcpProviderRound(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<ProviderToolRound> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const calls = new Map<number, ProviderToolCall>();
  let buffer = "";
  let eventData: string[] = [];
  let content = "";
  let reasoning = "";
  let received = 0;
  let done = false;
  let finishReason: string | null = null;
  let usage: ProviderTokenUsage | null = null;
  let invalidUsage = false;
  const malformed = () => new ChatAgentError("API вернул некорректный или оборванный поток ответа.", "upstream");

  function processEvent(data: string) {
    if (done) throw malformed();
    if (data === "[DONE]") { done = true; return; }
    let event: unknown;
    try { event = JSON.parse(data); } catch { throw malformed(); }
    if (!record(event) || !Array.isArray(event.choices) || event.choices.length > 1 || event.error) throw malformed();
    if (event.usage !== undefined && event.usage !== null) {
      const parsed = record(event.usage) ? parseProviderUsage(event.usage) : null;
      if (!parsed) invalidUsage = true;
      else usage = parsed;
    }
    if (event.choices.length === 0) return;
    const choice: unknown = event.choices[0];
    if (!record(choice) || choice.index !== 0 || !record(choice.delta) || finishReason !== null) throw malformed();
    const delta = choice.delta;
    if (delta.role != null && delta.role !== "assistant") throw malformed();
    for (const key of ["content", "reasoning_content"] as const) {
      if (delta[key] != null && typeof delta[key] !== "string") throw malformed();
    }
    if (typeof delta.content === "string") content += delta.content;
    if (typeof delta.reasoning_content === "string") reasoning += delta.reasoning_content;
    if (delta.tool_calls != null) {
      if (!Array.isArray(delta.tool_calls)) throw malformed();
      for (const fragment of delta.tool_calls) {
        if (!record(fragment) || !Number.isSafeInteger(fragment.index) || (fragment.index as number) < 0 || (fragment.index as number) >= LIMITS.maxToolsPerRound) {
          throw new ChatAgentError("Превышен лимит инструментов в одном ответе API.", "upstream");
        }
        const index = fragment.index as number;
        const call: ProviderToolCall = calls.get(index) ?? { id: "", type: "function", function: { name: "", arguments: "" } };
        if (fragment.type != null && fragment.type !== "function") throw malformed();
        if (fragment.id != null) {
          if (typeof fragment.id !== "string") throw malformed();
          call.id += fragment.id;
        }
        if (fragment.function != null) {
          if (!record(fragment.function)) throw malformed();
          for (const key of ["name", "arguments"] as const) {
            const value = fragment.function[key];
            if (value != null && typeof value !== "string") throw malformed();
            if (typeof value === "string") call.function[key] += value;
          }
        }
        if (Buffer.byteLength(call.id) > LIMITS.maxCallIdBytes || Buffer.byteLength(call.function.name) > LIMITS.maxCallIdBytes || Buffer.byteLength(call.function.arguments) > LIMITS.maxArgumentsBytes) {
          throw new ChatAgentError("Вызов инструмента превышает допустимый размер.", "upstream");
        }
        calls.set(index, call);
      }
    }
    if (choice.finish_reason != null) {
      if (choice.finish_reason === "length") throw new ChatAgentError("API исчерпал лимит вывода; неполный ответ не сохранён.", "upstream");
      if (choice.finish_reason !== "stop" && choice.finish_reason !== "tool_calls") throw malformed();
      finishReason = choice.finish_reason;
    }
  }

  function processLine(raw: string) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (!line) {
      if (eventData.length) processEvent(eventData.join("\n"));
      eventData = [];
    } else if (line.startsWith("data:")) {
      eventData.push(line.slice(5).replace(/^ /, ""));
    } else if (!line.startsWith(":") && !/^(event|id|retry):/.test(line)) {
      throw malformed();
    }
  }

  const onAbort = () => { void reader.cancel(signal.reason).catch(() => undefined); };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    signal.throwIfAborted();
    while (!done) {
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      received += next.value.byteLength;
      if (received > LIMITS.maxProviderResponseBytes) throw new ChatAgentError("Ответ API превышает допустимый размер.", "upstream");
      buffer += decoder.decode(next.value, { stream: true });
      let offset = 0;
      let newline: number;
      while ((newline = buffer.indexOf("\n", offset)) !== -1) {
        processLine(buffer.slice(offset, newline));
        offset = newline + 1;
      }
      buffer = buffer.slice(offset);
    }
    buffer += decoder.decode();
    if (!done || buffer.trim() || eventData.length || !finishReason) throw malformed();
    if ((finishReason === "tool_calls") !== (calls.size > 0) || (finishReason === "stop" && !content.trim())) throw malformed();
    const ordered = [...calls.entries()].sort(([left], [right]) => left - right);
    if (ordered.some(([index, call], position) => index !== position || !call.id || !call.function.name || !call.function.arguments)) throw malformed();
    return { content, reasoning_content: reasoning, tool_calls: ordered.map(([, call]) => call), usage: invalidUsage ? null : usage };
  } catch (cause) {
    if (signal.aborted) throw signal.reason;
    if (cause instanceof ChatAgentError) throw cause;
    throw new ChatAgentError("Не удалось полностью прочитать поток API.", "upstream", { cause });
  } finally {
    signal.removeEventListener("abort", onAbort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

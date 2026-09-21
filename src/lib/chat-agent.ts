import type {
  ChatAgentResponse,
  ChatRequestOptions,
  ProviderTokenUsage,
} from "./conversation-types";
import { getLiveModelProfile } from "./model-profiles";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatAgentConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type ChatAgentErrorKind = "configuration" | "upstream";

export class ChatAgentError extends Error {
  constructor(
    message: string,
    readonly kind: ChatAgentErrorKind,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ChatAgentError";
  }
}

export const CHAT_SYSTEM_PROMPT = `Ты Flash — универсальный AI-агент.
Отвечай на языке пользователя, по существу и без лишнего вступления.
Учитывай предыдущие сообщения диалога и давай законченные ответы.`;

type ProviderEvent = {
  choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[];
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
    prompt_cache_hit_tokens?: unknown;
    prompt_cache_miss_tokens?: unknown;
  };
};

function optionalTokenCount(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) return undefined;
  return value as number;
}

export function parseProviderUsage(
  value: ProviderEvent["usage"],
): ProviderTokenUsage | null {
  if (!value) return null;

  const promptTokens = optionalTokenCount(value.prompt_tokens);
  const completionTokens = optionalTokenCount(value.completion_tokens);
  const totalTokens = optionalTokenCount(value.total_tokens);
  const cacheHitTokens = optionalTokenCount(value.prompt_cache_hit_tokens);
  const cacheMissTokens = optionalTokenCount(value.prompt_cache_miss_tokens);
  if (
    promptTokens === null ||
    promptTokens === undefined ||
    completionTokens === null ||
    completionTokens === undefined ||
    totalTokens === null ||
    totalTokens === undefined ||
    cacheHitTokens === undefined ||
    cacheMissTokens === undefined ||
    totalTokens !== promptTokens + completionTokens ||
    (cacheHitTokens ?? 0) + (cacheMissTokens ?? 0) > promptTokens
  ) {
    return null;
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cacheHitTokens,
    cacheMissTokens,
  };
}

export function sseToChatResponse(
  body: ReadableStream<Uint8Array>,
): ChatAgentResponse {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let finalUsage: ProviderTokenUsage | null = null;
  let finishReason: string | null = null;
  let resolveFinishReason: (reason: string | null) => void = () => undefined;
  const finish = new Promise<string | null>((resolve) => {
    resolveFinishReason = resolve;
  });
  let resolveUsage: (usage: ProviderTokenUsage | null) => void = () => undefined;
  const usage = new Promise<ProviderTokenUsage | null>((resolve) => {
    resolveUsage = resolve;
  });

  function processLine(line: string, controller: TransformStreamDefaultController<Uint8Array>) {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;

    let event: ProviderEvent;
    try {
      event = JSON.parse(data) as ProviderEvent;
    } catch {
      return;
    }

    const parsedUsage = parseProviderUsage(event.usage);
    if (parsedUsage) finalUsage = parsedUsage;

    const reason = event.choices?.[0]?.finish_reason;
    if (typeof reason === "string") finishReason = reason;

    const delta = event.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta.length > 0) {
      controller.enqueue(encoder.encode(delta));
    }
  }

  const stream = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) processLine(line, controller);
      },
      flush(controller) {
        buffer += decoder.decode();
        if (buffer) processLine(buffer, controller);
        resolveUsage(finalUsage);
        resolveFinishReason(finishReason);
      },
    }),
  );

  return { stream, usage, finishReason: finish };
}

export class ChatAgent {
  get model(): string {
    return this.config.model;
  }

  private constructor(private readonly config: ChatAgentConfig) {}

  static fromEnvironment(env: NodeJS.ProcessEnv = process.env): ChatAgent {
    const baseUrl = env.OPENAI_BASE_URL;
    const apiKey = env.OPENAI_API_KEY;
    const model = env.OPENAI_MODEL;
    const missing = [
      !baseUrl && "OPENAI_BASE_URL",
      !apiKey && "OPENAI_API_KEY",
      !model && "OPENAI_MODEL",
    ].filter((name): name is string => Boolean(name));

    if (!baseUrl || !apiKey || !model) {
      throw new ChatAgentError(
        `Не заданы переменные окружения: ${missing.join(", ")}. Заполните .env.local по образцу .env.example и перезапустите сервер.`,
        "configuration",
      );
    }

    return new ChatAgent({ baseUrl, apiKey, model });
  }

  async respond(
    messages: readonly ChatMessage[],
    signal: AbortSignal,
    options?: ChatRequestOptions,
  ): Promise<ChatAgentResponse> {
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    let profile;
    try {
      profile = getLiveModelProfile(this.config.model);
    } catch (error) {
      throw new ChatAgentError(
        error instanceof Error ? error.message : "Неизвестная модель.",
        "configuration",
        { cause: error },
      );
    }
    const systemMessages = options?.systemMessages ?? [CHAT_SYSTEM_PROMPT];
    const maxOutputTokens = options?.maxOutputTokens ?? profile.responseReserveTokens;
    if (
      systemMessages.length === 0 ||
      systemMessages.some((message) => typeof message !== "string" || !message.trim())
    ) {
      throw new ChatAgentError(
        "Список system messages должен содержать непустые строки.",
        "configuration",
      );
    }
    if (
      !Number.isSafeInteger(maxOutputTokens) ||
      maxOutputTokens <= 0 ||
      maxOutputTokens > profile.maxOutputTokens
    ) {
      throw new ChatAgentError(
        "Лимит ответа должен быть допустимым положительным целым числом.",
        "configuration",
      );
    }
    let response: Response;

    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            ...systemMessages.map((content) => ({ role: "system" as const, content })),
            ...messages,
          ],
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: maxOutputTokens,
        }),
        signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new ChatAgentError(`Не удалось соединиться с API по адресу ${url}.`, "upstream", {
        cause: error,
      });
    }

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => "");
      throw new ChatAgentError(
        `API вернул ${response.status}. ${detail}`.trim(),
        "upstream",
      );
    }

    return sseToChatResponse(response.body);
  }
}

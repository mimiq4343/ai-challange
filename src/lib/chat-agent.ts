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

const INSTRUCTIONS = `Ты Flash — универсальный AI-агент.
Отвечай на языке пользователя, по существу и без лишнего вступления.
Учитывай предыдущие сообщения диалога и давай законченные ответы.`;

function sseToTextStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;

          let event: { choices?: { delta?: { content?: unknown } }[] };
          try {
            event = JSON.parse(data);
          } catch {
            continue;
          }

          const delta = event.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            controller.enqueue(encoder.encode(delta));
          }
        }
      },
    }),
  );
}

export class ChatAgent {
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
    messages: ChatMessage[],
    signal: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
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
          messages: [{ role: "system", content: INSTRUCTIONS }, ...messages],
          stream: true,
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

    return sseToTextStream(response.body);
  }
}

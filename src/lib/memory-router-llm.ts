import { ChatAgentError, parseProviderUsage } from "./chat-agent";
import type { ProviderTokenUsage } from "./conversation-types";
import { getLiveModelProfile } from "./model-profiles";

export type MemoryRouterCompletion = {
  content: string;
  usage: ProviderTokenUsage | null;
};

export type MemoryRouterLlm = {
  readonly model: string;
  complete(input: {
    systemPrompt: string;
    userPrompt: string;
    maxOutputTokens: number;
  }): Promise<MemoryRouterCompletion>;
};

type RouterConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

type CompletionResponse = {
  choices?: { message?: { content?: unknown } }[];
  usage?: Parameters<typeof parseProviderUsage>[0];
};

/**
 * Отдельный не-стримовый клиент для роутера памяти: один запрос без retry,
 * строгий JSON в ответе и учёт provider usage.
 */
export class ProviderMemoryRouterLlm implements MemoryRouterLlm {
  get model(): string {
    return this.config.model;
  }

  private constructor(private readonly config: RouterConfig) {}

  static fromEnvironment(env: NodeJS.ProcessEnv = process.env): ProviderMemoryRouterLlm {
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

    return new ProviderMemoryRouterLlm({ baseUrl, apiKey, model });
  }

  async complete(input: {
    systemPrompt: string;
    userPrompt: string;
    maxOutputTokens: number;
  }): Promise<MemoryRouterCompletion> {
    const profile = getLiveModelProfile(this.config.model);
    if (input.maxOutputTokens <= 0 || input.maxOutputTokens > profile.maxOutputTokens) {
      throw new ChatAgentError(
        "Лимит ответа роутера памяти вне допустимого диапазона.",
        "configuration",
      );
    }

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
          messages: [
            { role: "system", content: input.systemPrompt },
            { role: "user", content: input.userPrompt },
          ],
          stream: false,
          max_tokens: input.maxOutputTokens,
          temperature: 0,
          response_format: { type: "json_object" },
        }),
      });
    } catch (error) {
      throw new ChatAgentError(
        `Не удалось соединиться с API роутера памяти по адресу ${url}.`,
        "upstream",
        { cause: error },
      );
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new ChatAgentError(
        `Роутер памяти получил ${response.status}. ${detail}`.trim(),
        "upstream",
      );
    }

    const payload = (await response.json()) as CompletionResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new ChatAgentError("Роутер памяти вернул пустой ответ.", "upstream");
    }

    return { content, usage: parseProviderUsage(payload.usage) };
  }
}

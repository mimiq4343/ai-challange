import "server-only";

import { getConversationStore, type SqliteConversationStore } from "./conversation-store";
import type { OverflowOutcome, OverflowRun } from "./conversation-types";
import { NEMOTRON_OVERFLOW_PROFILE } from "./model-profiles";
import { buildOverflowInput } from "./token-counter";

export type OverflowFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type OverflowStore = Pick<SqliteConversationStore, "saveOverflowRun">;

type OversizedInputBuilder = (
  targetTokens?: number,
) => Promise<{ text: string; tokens: number }>;

export class OverflowExperimentError extends Error {
  constructor(
    message: string,
    readonly kind: "configuration" | "validation",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OverflowExperimentError";
  }
}

export function classifyOverflowResult(input: {
  ok: boolean;
  localInputTokens: number;
  providerInputTokens: number | null;
}): Exclude<OverflowOutcome, "network_error"> {
  if (!input.ok) return "rejected";
  if (
    input.providerInputTokens !== null &&
    input.providerInputTokens < input.localInputTokens
  ) {
    return "truncated";
  }
  return "accepted";
}

function normalizeTokenCount(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null;
}

async function readBoundedText(response: Response, maxBytes = 8_192): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let remaining = maxBytes;
  let result = "";
  while (remaining > 0) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = value.subarray(0, remaining);
    result += decoder.decode(chunk, { stream: chunk.byteLength === value.byteLength });
    remaining -= chunk.byteLength;
    if (chunk.byteLength < value.byteLength) {
      await reader.cancel();
      break;
    }
  }
  result += decoder.decode();
  return result;
}

function safeProviderMessage(text: string): string | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: unknown } | string;
      message?: unknown;
    };
    if (typeof parsed.error === "string") return parsed.error;
    if (typeof parsed.error?.message === "string") return parsed.error.message;
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    return text;
  }
  return text;
}

export class OverflowExperimentService {
  constructor(
    private readonly store: OverflowStore = getConversationStore(),
    private readonly fetchImpl: OverflowFetch = fetch,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly buildInput: OversizedInputBuilder = buildOverflowInput,
  ) {}

  async run(input: { confirmed: boolean; signal: AbortSignal }): Promise<OverflowRun> {
    if (!input.confirmed) {
      throw new OverflowExperimentError(
        "Подтвердите реальный overflow-тест.",
        "validation",
      );
    }

    const apiKey = this.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) {
      throw new OverflowExperimentError(
        "Не задан OPENROUTER_API_KEY для реального overflow-теста.",
        "configuration",
      );
    }

    input.signal.throwIfAborted();
    const oversized = await this.buildInput(NEMOTRON_OVERFLOW_PROFILE.targetInputTokens);
    if (oversized.tokens <= NEMOTRON_OVERFLOW_PROFILE.contextWindow) {
      throw new OverflowExperimentError(
        "Локальный input не превышает context window overflow-модели.",
        "validation",
      );
    }

    const startedAt = performance.now();
    try {
      const timeoutSignal = AbortSignal.timeout(60_000);
      const response = await this.fetchImpl(NEMOTRON_OVERFLOW_PROFILE.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: NEMOTRON_OVERFLOW_PROFILE.model,
          input: oversized.text,
        }),
        signal: AbortSignal.any([input.signal, timeoutSignal]),
      });
      const text = await readBoundedText(response, response.ok ? 256_000 : 8_192);
      let providerInputTokens: number | null = null;
      let errorMessage: string | null = null;
      if (response.ok) {
        try {
          const parsed = JSON.parse(text) as {
            usage?: { prompt_tokens?: unknown; total_tokens?: unknown };
          };
          providerInputTokens = normalizeTokenCount(
            parsed.usage?.prompt_tokens ?? parsed.usage?.total_tokens,
          );
        } catch {
          errorMessage = "OpenRouter вернул недействительный JSON.";
        }
      } else {
        errorMessage = safeProviderMessage(text);
      }

      return this.store.saveOverflowRun({
        model: NEMOTRON_OVERFLOW_PROFILE.model,
        contextLimit: NEMOTRON_OVERFLOW_PROFILE.contextWindow,
        localInputTokens: oversized.tokens,
        providerInputTokens,
        outcome: classifyOverflowResult({
          ok: response.ok,
          localInputTokens: oversized.tokens,
          providerInputTokens,
        }),
        httpStatus: response.status,
        errorMessage,
        durationMs: Math.round(performance.now() - startedAt),
        costMicrosUsd: NEMOTRON_OVERFLOW_PROFILE.costMicrosUsd,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Сетевая ошибка OpenRouter.";
      return this.store.saveOverflowRun({
        model: NEMOTRON_OVERFLOW_PROFILE.model,
        contextLimit: NEMOTRON_OVERFLOW_PROFILE.contextWindow,
        localInputTokens: oversized.tokens,
        providerInputTokens: null,
        outcome: "network_error",
        httpStatus: null,
        errorMessage: message,
        durationMs: Math.round(performance.now() - startedAt),
        costMicrosUsd: NEMOTRON_OVERFLOW_PROFILE.costMicrosUsd,
      });
    }
  }
}

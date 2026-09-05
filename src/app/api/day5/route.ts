import { NextRequest } from "next/server";
import {
  DAY5_PROVIDERS,
  EMPTY_USAGE,
  costOf,
  modelById,
  rateFor,
  type ModelSpec,
  type RunMetrics,
  type Usage,
} from "@/lib/day5";

// Маршрут задания Day 5: тот же запрос уходит на выбранную из конфига модель, а
// вместе с текстом ответа наружу отдаются метрики прогона. Провайдер и имя
// модели берутся только из конфига: клиент передаёт идентификатор колонки, а не
// адрес и не имя модели.

type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) return false;
  const msg = value as Record<string, unknown>;
  return (
    (msg.role === "user" || msg.role === "assistant" || msg.role === "system") &&
    typeof msg.content === "string"
  );
}

type Options = {
  system?: string;
  max_tokens?: number;
  temperature?: number;
  response_format?: { type: "json_object" };
};

function validateOptions(body: Record<string, unknown>): { options?: Options; error?: string } {
  const options: Options = {};

  if (body.system !== undefined) {
    if (typeof body.system !== "string" || body.system.length === 0 || body.system.length > 8000) {
      return { error: "system должен быть непустой строкой до 8000 символов." };
    }
    options.system = body.system;
  }
  if (body.max_tokens !== undefined) {
    const value = body.max_tokens;
    if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 8192) {
      return { error: "max_tokens должен быть целым числом от 1 до 8192." };
    }
    options.max_tokens = value as number;
  }
  if (body.temperature !== undefined) {
    const value = body.temperature;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 2) {
      return { error: "temperature должен быть числом от 0 до 2." };
    }
    options.temperature = value;
  }
  if (body.response_format !== undefined) {
    const format = body.response_format as Record<string, unknown> | null;
    if (typeof format !== "object" || format === null || format.type !== "json_object") {
      return { error: 'response_format поддерживается только вида {"type":"json_object"}.' };
    }
    options.response_format = { type: "json_object" };
  }
  return { options };
}

function readNumber(source: Record<string, unknown> | undefined, key: string): number {
  const value = source?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Приводит usage разных провайдеров к одному виду. DeepSeek сообщает попадание в
 * кэш промпта отдельным полем, Groq такого поля не отдаёт вовсе.
 */
function normalizeUsage(raw: Record<string, unknown>): Usage {
  const details = raw.completion_tokens_details as Record<string, unknown> | undefined;
  const promptDetails = raw.prompt_tokens_details as Record<string, unknown> | undefined;
  const cached =
    readNumber(raw, "prompt_cache_hit_tokens") || readNumber(promptDetails, "cached_tokens");
  return {
    promptTokens: readNumber(raw, "prompt_tokens"),
    cachedPromptTokens: cached,
    completionTokens: readNumber(raw, "completion_tokens"),
    reasoningTokens: readNumber(details, "reasoning_tokens"),
    totalTokens: readNumber(raw, "total_tokens"),
  };
}

const encoder = new TextEncoder();

function line(event: Record<string, unknown>): Uint8Array {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

/**
 * Переливает SSE провайдера в NDJSON: дельты текста по мере поступления, а в
 * конце одно событие с метриками. Время меряется здесь, а не в браузере: так в
 * замер не попадают ни задержки React, ни перерисовки.
 */
function toMetricStream(
  upstream: ReadableStream<Uint8Array>,
  spec: ModelSpec,
  startedAt: number,
  requestedAt: Date,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = "";
  let ttftMs = 0;
  let usage: Usage = EMPTY_USAGE;

  return upstream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          if (!raw.startsWith("data:")) continue;
          const data = raw.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          let parsed: {
            choices?: { delta?: { content?: unknown } }[];
            usage?: Record<string, unknown> | null;
          };
          try {
            parsed = JSON.parse(data);
          } catch {
            continue; // служебный или обрезанный фрейм SSE, полезной нагрузки в нём нет
          }
          if (parsed.usage) usage = normalizeUsage(parsed.usage);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            if (ttftMs === 0) ttftMs = Date.now() - startedAt;
            controller.enqueue(line({ type: "delta", text: delta }));
          }
        }
      },
      flush(controller) {
        const totalMs = Date.now() - startedAt;
        const rate = rateFor(spec, requestedAt);
        const generationMs = Math.max(0, totalMs - ttftMs);
        const metrics: RunMetrics = {
          ttftMs,
          totalMs,
          usage,
          costUsd: costOf(usage, rate),
          rateNote: rate.note,
          tokensPerSec:
            generationMs > 0 && usage.completionTokens > 0
              ? usage.completionTokens / (generationMs / 1000)
              : null,
        };
        controller.enqueue(line({ type: "done", metrics }));
      },
    }),
  );
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Некорректный JSON в теле запроса." }, { status: 400 });
  }

  const spec = typeof body.modelId === "string" ? modelById(body.modelId) : undefined;
  if (!spec) {
    return Response.json(
      { error: "Поле modelId должно называть одну из моделей эксперимента Day 5." },
      { status: 400 },
    );
  }

  const provider = DAY5_PROVIDERS[spec.provider];
  const baseUrl = process.env[provider.baseUrlEnv];
  const apiKey = process.env[provider.apiKeyEnv];
  const missing = [!baseUrl && provider.baseUrlEnv, !apiKey && provider.apiKeyEnv].filter(Boolean);
  if (missing.length > 0) {
    return Response.json(
      {
        error: `Не заданы переменные окружения для провайдера ${provider.label}: ${missing.join(", ")}. Заполните .env.local по образцу .env.example и перезапустите сервер.`,
      },
      { status: 500 },
    );
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0 || !messages.every(isChatMessage)) {
    return Response.json(
      { error: "Ожидается непустой массив messages с ролями user/assistant." },
      { status: 400 },
    );
  }

  const { options, error } = validateOptions(body);
  if (error) return Response.json({ error }, { status: 400 });

  const { system, ...passthrough } = options as Options;
  const fullMessages = system ? [{ role: "system", content: system }, ...messages] : messages;

  const url = `${baseUrl!.replace(/\/+$/, "")}/chat/completions`;
  const requestedAt = new Date();
  const startedAt = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: spec.model,
        messages: fullMessages,
        stream: true,
        // Без этого поля провайдер не присылает usage в стриминговом ответе, а
        // без usage нечем считать ни токены, ни стоимость.
        stream_options: { include_usage: true },
        ...spec.params,
        ...passthrough,
      }),
      signal: req.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return Response.json(
      { error: `Не удалось соединиться с API ${provider.label} по адресу ${url}.`, cause: String(err) },
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return Response.json(
      { error: `API ${provider.label} вернул ${upstream.status}. ${detail}`.trim() },
      { status: 502 },
    );
  }

  return new Response(toMetricStream(upstream.body, spec, startedAt, requestedAt), {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

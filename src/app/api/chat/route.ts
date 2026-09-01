import { NextRequest } from "next/server";

type ChatMessage = { role: "user" | "assistant"; content: string };

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) return false;
  const msg = value as Record<string, unknown>;
  return (
    (msg.role === "user" || msg.role === "assistant") &&
    typeof msg.content === "string"
  );
}

// Превращаем SSE-поток провайдера в поток чистого текста (только дельты контента).
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
          let parsed: { choices?: { delta?: { content?: unknown } }[] };
          try {
            parsed = JSON.parse(data);
          } catch {
            continue; // служебный или обрезанный фрейм SSE, текста в нём нет
          }
          const delta = parsed.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            controller.enqueue(encoder.encode(delta));
          }
        }
      },
    }),
  );
}

export async function POST(req: NextRequest) {
  const baseUrl = process.env.OPENAI_BASE_URL;
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  const missing = [
    !baseUrl && "OPENAI_BASE_URL",
    !apiKey && "OPENAI_API_KEY",
    !model && "OPENAI_MODEL",
  ].filter(Boolean);
  if (missing.length > 0) {
    return Response.json(
      {
        error: `Не заданы переменные окружения: ${missing.join(", ")}. Заполните .env.local по образцу .env.example и перезапустите сервер.`,
      },
      { status: 500 },
    );
  }

  let messages: unknown;
  try {
    ({ messages } = await req.json());
  } catch {
    return Response.json({ error: "Некорректный JSON в теле запроса." }, { status: 400 });
  }
  if (!Array.isArray(messages) || messages.length === 0 || !messages.every(isChatMessage)) {
    return Response.json(
      { error: "Ожидается непустой массив messages с ролями user/assistant." },
      { status: 400 },
    );
  }

  const url = `${baseUrl!.replace(/\/+$/, "")}/chat/completions`;
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, stream: true }),
      signal: req.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return Response.json(
      { error: `Не удалось соединиться с API по адресу ${url}.`, cause: String(err) },
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return Response.json(
      { error: `API вернул ${upstream.status}. ${detail}`.trim() },
      { status: 502 },
    );
  }

  return new Response(sseToTextStream(upstream.body), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

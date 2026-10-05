import { setTimeout as delay } from "node:timers/promises";
import { DOCUMENT_INDEX_CONFIG } from "./document-config";

type EmbeddingFetch = (url: string, init: RequestInit) => Promise<Response>;
type EmbeddingUsage = { vectors: number[][]; tokens: number };

export function validateEmbedding(vector: unknown, dimensions: number): asserts vector is number[] {
  if (!Array.isArray(vector) || vector.length !== dimensions || !vector.every((value) => typeof value === "number" && Number.isFinite(Math.fround(value))) || !vector.some((value) => Math.fround(value) !== 0)) {
    throw new Error(`Недействительный вектор эмбеддинга: требуется ${dimensions} конечных чисел и ненулевая норма.`);
  }
}

async function responsePayload(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("OpenRouter вернул пустой ответ.");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > DOCUMENT_INDEX_CONFIG.maxResponseBytes) {
        await reader.cancel();
        throw new Error("Ответ OpenRouter превышает допустимый объём.");
      }
      parts.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts)));
}

export class DocumentEmbeddingClient {
  private previousRequestAt = 0;

  constructor(private readonly apiKey: string, private readonly fetchImpl: EmbeddingFetch = fetch) {
    if (!apiKey.trim()) throw new Error("Не задан OPENROUTER_API_KEY для индексации документов.");
  }

  async embed(
    inputs: readonly string[],
    inputType: "search_document" | "search_query",
    signal?: AbortSignal,
  ): Promise<EmbeddingUsage> {
    if (!inputs.length || inputs.length > DOCUMENT_INDEX_CONFIG.batchSize || inputs.some((text) => !text.trim()) || inputs.reduce((sum, text) => sum + text.length, 0) > DOCUMENT_INDEX_CONFIG.batchCharacters) {
      throw new Error("Недопустимый размер или пустой текст пакета эмбеддингов.");
    }
    signal?.throwIfAborted();
    const wait = DOCUMENT_INDEX_CONFIG.requestIntervalMs - (Date.now() - this.previousRequestAt);
    if (wait > 0) await delay(wait, undefined, { signal });
    this.previousRequestAt = Date.now();
    const timeout = AbortSignal.timeout(DOCUMENT_INDEX_CONFIG.requestTimeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    requestSignal.throwIfAborted();
    let response: Response;
    try {
      response = await this.fetchImpl(DOCUMENT_INDEX_CONFIG.endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey.trim()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: DOCUMENT_INDEX_CONFIG.model, input: inputs, input_type: inputType, encoding_format: "float" }),
        signal: requestSignal,
      });
    } catch (cause) {
      throw new Error("Не удалось получить эмбеддинги OpenRouter: сеть, отмена или таймаут запроса.", { cause });
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`OpenRouter Embeddings вернул HTTP ${response.status}. Проверьте ключ, доступность модели и лимиты запросов.`);
    }
    let payload: { data?: unknown; usage?: { prompt_tokens?: unknown; cost?: unknown }; model?: unknown };
    try {
      const parsed = await responsePayload(response);
      if (!parsed || typeof parsed !== "object") throw new Error("Ожидался объект ответа.");
      payload = parsed;
    } catch (cause) {
      throw new Error("Недействительный JSON в ответе OpenRouter Embeddings.", { cause });
    }
    if (typeof payload.model !== "string" || !payload.model || !Array.isArray(payload.data) || payload.data.length !== inputs.length) {
      throw new Error("OpenRouter вернул недействительный список эмбеддингов.");
    }
    if (!DOCUMENT_INDEX_CONFIG.responseModels.includes(payload.model)) throw new Error("OpenRouter вернул другую модель эмбеддингов.");
    if (payload.usage?.cost !== 0) throw new Error("OpenRouter не подтвердил нулевую стоимость бесплатных эмбеддингов.");
    const vectors: number[][] = new Array(inputs.length);
    const seen = new Set<number>();
    for (const item of payload.data) {
      if (!item || typeof item !== "object" || !Number.isSafeInteger(item.index) || item.index < 0 || item.index >= inputs.length || seen.has(item.index)) {
        throw new Error("OpenRouter вернул недействительные индексы эмбеддингов.");
      }
      validateEmbedding(item.embedding, DOCUMENT_INDEX_CONFIG.dimensions);
      vectors[item.index] = item.embedding;
      seen.add(item.index);
    }
    const tokens = payload.usage?.prompt_tokens;
    if (typeof tokens !== "number" || !Number.isSafeInteger(tokens) || tokens < 0) throw new Error("OpenRouter не вернул действительный prompt_tokens.");
    return { vectors, tokens };
  }
}

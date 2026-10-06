import "server-only";
import { resolve } from "node:path";
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { validateEmbedding } from "./document-embeddings";
import { RAG_EMBEDDING_CONFIG } from "./rag-embedding-config";

export class LocalDocumentEmbeddingClient {
  private extractor?: Promise<FeatureExtractionPipeline>;

  constructor(private readonly modelPath: string = resolve(RAG_EMBEDDING_CONFIG.modelPath)) {}

  private model(): Promise<FeatureExtractionPipeline> {
    if (!this.extractor) {
      this.extractor = pipeline("feature-extraction", this.modelPath, {
        local_files_only: true, dtype: "q8", device: "cpu",
        session_options: { intraOpNumThreads: RAG_EMBEDDING_CONFIG.threads, interOpNumThreads: 1 },
      }).catch((cause: unknown) => {
        this.extractor = undefined;
        throw new Error("Локальная модель эмбеддингов недоступна. Выполните npm run rag:index.", { cause });
      });
    }
    return this.extractor;
  }

  async countTokens(text: string): Promise<number> {
    const extractor = await this.model();
    return extractor.tokenizer.encode(text, { add_special_tokens: false }).length;
  }

  async embed(inputs: readonly string[], inputType: "search_document" | "search_query", signal?: AbortSignal): Promise<{ vectors: number[][]; tokens: number }> {
    if (!inputs.length || inputs.length > RAG_EMBEDDING_CONFIG.batchSize || inputs.some((text) => !text.trim()) || inputs.reduce((sum, text) => sum + text.length, 0) > RAG_EMBEDDING_CONFIG.batchCharacters) {
      throw new Error("Недопустимый размер или пустой текст пакета локальных эмбеддингов.");
    }
    if (inputType !== "search_document" && inputType !== "search_query") throw new Error("Неизвестный тип текста для эмбеддингов.");
    signal?.throwIfAborted();
    const extractor = await this.model();
    signal?.throwIfAborted();
    const prefix = inputType === "search_query" ? "query: " : "passage: ";
    const texts = inputs.map((text) => `${prefix}${text}`);
    const lengths = texts.map((text) => extractor.tokenizer.encode(text).length);
    if (inputType === "search_document" && lengths.some((length) => length > RAG_EMBEDDING_CONFIG.contextTokens)) {
      throw new Error("Чанк превышает контекст локальной модели. Пересоздайте индекс через npm run rag:index.");
    }
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    signal?.throwIfAborted();
    const vectors = output.tolist() as number[][];
    if (vectors.length !== inputs.length) throw new Error("Локальная модель вернула неверное число векторов.");
    for (const vector of vectors) validateEmbedding(vector, RAG_EMBEDDING_CONFIG.dimensions);
    return { vectors, tokens: lengths.reduce((sum, length) => sum + Math.min(length, RAG_EMBEDDING_CONFIG.contextTokens), 0) };
  }
}

// Одна ONNX-сессия на серверный модуль; зависимости агента передаются явно.
export const localDocumentEmbedder = new LocalDocumentEmbeddingClient();

import "server-only";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatAgent } from "./chat-agent";
import { CodeReviewError, reviewSnapshot } from "./code-review-agent";
import { CODE_REVIEW_CONFIG as CONFIG } from "./code-review-config";
import { buildReviewIndex, retrieveReviewContext } from "./code-review-rag";
import type { CodeReviewReport, ReviewSnapshot } from "./code-review-types";
import { localDocumentEmbedder } from "./local-document-embeddings";
import { prepareRagModel } from "./rag-model-download";

/** Один анализатор для ручного сравнения и инструмента веб-агента. */
export async function analyzeReviewSnapshot(root: string, snapshot: ReviewSnapshot, signal: AbortSignal, onProgress: (message: string) => void): Promise<CodeReviewReport> {
  if (!snapshot.files.length) return { model: CONFIG.model, indexId: null, snapshot, reviews: [] };
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_BASE_URL) {
    throw new CodeReviewError("На сервере не заданы OPENAI_API_KEY и/или OPENAI_BASE_URL.");
  }
  const llm = ChatAgent.fromEnvironment({ ...process.env, OPENAI_MODEL: CONFIG.model });
  onProgress("Подготовка модели поиска по документации и коду…");
  await prepareRagModel(root, signal, onProgress);
  const indexRoot = await mkdtemp(join(tmpdir(), "flash-web-review-"));
  try {
    const index = await buildReviewIndex({ root, baseSha: snapshot.baseSha, indexRoot, client: localDocumentEmbedder, signal, onProgress });
    return await reviewSnapshot({ snapshot, indexId: index.id, llm, signal, onProgress,
      retrieve: (file, requestSignal) => retrieveReviewContext(index, localDocumentEmbedder, file, requestSignal),
      onFailure: (path, reason) => {
        console.error("code_review_file_failed", { path, reason });
        onProgress(`Не проверен ${path}: ${reason}`);
      },
    });
  } finally { await rm(indexRoot, { recursive: true, force: true }); }
}

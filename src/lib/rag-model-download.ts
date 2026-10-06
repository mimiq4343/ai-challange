import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { RAG_EMBEDDING_CONFIG, RAG_MODEL_FILES } from "./rag-embedding-config";

async function checksum(path: string): Promise<string | null> {
  const hash = createHash("sha256");
  try {
    for await (const bytes of createReadStream(path)) hash.update(bytes);
    return hash.digest("hex");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
}

export async function prepareRagModel(root: string, signal?: AbortSignal, onProgress?: (message: string) => void): Promise<void> {
  for (const file of RAG_MODEL_FILES) {
    signal?.throwIfAborted();
    const target = resolve(root, RAG_EMBEDDING_CONFIG.modelPath, file.path);
    const existing = await checksum(target);
    if (existing === file.sha256) continue;
    if (existing !== null) throw new Error(`Контрольная сумма ${target} не совпадает. Удалите повреждённый файл перед повторной загрузкой.`);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    const requestSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(RAG_EMBEDDING_CONFIG.downloadTimeoutMs)]);
    onProgress?.(`Загрузка ${RAG_EMBEDDING_CONFIG.model}/${file.path}…`);
    try {
      const url = `https://huggingface.co/${RAG_EMBEDDING_CONFIG.model}/resolve/${RAG_EMBEDDING_CONFIG.revision}/${file.path}`;
      const response = await fetch(url, { signal: requestSignal });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new Error(`Загрузка модели вернула HTTP ${response.status}: ${file.path}.`);
      }
      await pipeline(Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>), createWriteStream(temporary, { flags: "wx" }), { signal: requestSignal });
      if (await checksum(temporary) !== file.sha256) throw new Error(`Контрольная сумма загруженного ${file.path} не совпадает.`);
      await rename(temporary, target);
    } finally { await rm(temporary, { force: true }); }
  }
}

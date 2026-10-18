import { z } from "zod";
import { CODE_REVIEW_WEB_CONFIG as CONFIG } from "./code-review-config";
import type { CodeReviewEvent } from "./code-review-types";

const sha = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const side = z.enum(["base", "head"]);
const snapshotSchema = z.object({
  baseSha: sha, headSha: sha, mergeBaseSha: sha, totalFiles: z.number().int().nonnegative(),
  files: z.array(z.object({ path: z.string(), previousPath: z.string().optional(), status: z.string(), side,
    content: z.string(), patch: z.string(), changedLines: z.array(z.number().int().positive()) })),
  skipped: z.array(z.object({ path: z.string(), reason: z.string() })),
});
export const codeReviewEventSchema: z.ZodType<CodeReviewEvent> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("progress"), message: z.string() }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({ type: z.literal("snapshot"), snapshot: snapshotSchema }),
  z.object({ type: z.literal("result"), report: z.object({
    model: z.string(), indexId: z.string().nullable(), snapshot: snapshotSchema,
    reviews: z.array(z.object({ path: z.string(), side, limitations: z.array(z.string()),
      sources: z.array(z.object({ id: z.string(), source: z.string(), section: z.string(), startLine: z.number(), endLine: z.number(), text: z.string(), score: z.number() })),
      findings: z.array(z.object({ category: z.enum(["bug", "architecture", "recommendation"]), severity: z.enum(["high", "medium", "low"]),
        line: z.number().int().positive().nullable(), title: z.string(), body: z.string(), recommendation: z.string(), sourceIds: z.array(z.string()) })),
    })),
  }) }),
]);

/** Закрытие потока без result не подтверждает завершение ревью. */
export async function consumeCodeReviewStream(stream: ReadableStream<Uint8Array>, onEvent: (event: CodeReviewEvent) => void): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  function dispatch(line: string): boolean {
    if (!line.trim()) return false;
    let event: CodeReviewEvent;
    try { event = codeReviewEventSchema.parse(JSON.parse(line)); }
    catch (cause) { throw new Error("Некорректное событие в ответе ревью.", { cause }); }
    if (event.type === "error") throw new Error(event.message);
    onEvent(event);
    return event.type === "result";
  }
  try {
    for (;;) {
      const { done, value } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        if (newline > CONFIG.maxEventCharacters) throw new Error("Событие ревью превышает допустимый объём.");
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (dispatch(line)) return;
      }
      if (pending.length > CONFIG.maxEventCharacters) throw new Error("Событие ревью превышает допустимый объём.");
      if (done) {
        if (pending && dispatch(pending)) return;
        throw new Error("Ответ оборвался до завершения ревью. Запустите проверку ещё раз.");
      }
    }
  } finally {
    try { await reader.cancel(); } finally { reader.releaseLock(); }
  }
}

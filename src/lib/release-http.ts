import "server-only";
import { z } from "zod";
import { ChatAgentError } from "./chat-agent";
import { validateMcpMutation } from "./mcp-api";
import { runRelease } from "./release-agent";
import { RELEASE_CONFIG as CONFIG } from "./release-config";
import { readReleaseWorkspace } from "./release-git";
import { ReleaseError, type ReleaseEvent } from "./release-types";

const headers = { "Cache-Control": "no-store" };
const inputSchema = z.strictObject({ baseRef: z.string().min(1).max(300), headRef: z.string().min(1).max(300) });

export async function handleReleaseWorkspace(request: Request, root = process.cwd()): Promise<Response> {
  try { return Response.json(await readReleaseWorkspace(root, request.signal), { headers }); }
  catch (cause) {
    if (request.signal.aborted) return new Response(null, { status: 499, headers });
    console.error("release_refs_failed", { error: cause instanceof Error ? cause.name : "UnknownError" });
    return Response.json({ error: "Не удалось прочитать ветки и теги. Проверьте Git и origin репозитория GitHub." }, { status: 502, headers });
  }
}

async function readInput(request: Request): Promise<z.infer<typeof inputSchema> | Response> {
  if (!request.body) return Response.json({ error: "Выберите базу и коммит релиза." }, { status: 400, headers });
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > CONFIG.maxRequestBytes) { await reader.cancel(); return Response.json({ error: "Запрос превышает допустимый объём." }, { status: 413, headers }); }
      parts.push(part.value);
    }
  } finally { reader.releaseLock(); }
  try { return inputSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts)))); }
  catch { return Response.json({ error: "Ожидаются только baseRef и headRef из списка веток и тегов." }, { status: 400, headers }); }
}

export async function handleRelease(request: Request, root = process.cwd()): Promise<Response> {
  const rejected = validateMcpMutation(request);
  if (rejected) return rejected.status === 403 ? Response.json({ error: "Подготовка релиза доступна только с этого сайта." }, { status: 403, headers }) : rejected;
  const input = await readInput(request);
  if (input instanceof Response) return input;
  const abort = new AbortController();
  const deadline = AbortSignal.timeout(CONFIG.runTimeoutMs);
  const signal = AbortSignal.any([request.signal, abort.signal, deadline]);
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: ReleaseEvent) => {
        if (!closed && !abort.signal.aborted && !request.signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      void (async () => {
        try {
          const report = await runRelease(root, input, signal, send);
          signal.throwIfAborted();
          send({ type: "result", report });
        } catch (cause) {
          if (!abort.signal.aborted && !request.signal.aborted) {
            const expected = cause instanceof ReleaseError || (cause instanceof ChatAgentError && cause.kind === "configuration");
            if (!expected) console.error("release_failed", { error: cause instanceof Error ? cause.name : "UnknownError" });
            send({ type: "error", message: deadline.aborted ? "Истёк таймаут подготовки релиза. Выберите меньший диапазон."
              : expected ? cause.message : "Не удалось подготовить релиз. Проверьте Git и доступ к модели; полный ответ AI не сохранён." });
          }
        } finally { if (!closed) { closed = true; controller.close(); } }
      })();
    },
    cancel(reason) { closed = true; abort.abort(reason); },
  });
  return new Response(stream, { headers: { ...headers, "Content-Type": "application/x-ndjson; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
}

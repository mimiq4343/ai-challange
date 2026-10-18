import "server-only";
import { CodeReviewError } from "./code-review-agent";
import { CODE_REVIEW_WEB_CONFIG as WEB_CONFIG } from "./code-review-config";
import { collectReviewSnapshot, readReviewWorkspace } from "./code-review-git";
import { analyzeReviewSnapshot } from "./code-review-runner";
import type { CodeReviewEvent } from "./code-review-types";
import { validateMcpMutation } from "./mcp-api";

const headers = { "Cache-Control": "no-store" };

async function readInput(request: Request): Promise<{ baseRef: string; headRef: string } | Response> {
  if (!request.body) return Response.json({ error: "Выберите базовую и проверяемую ветки." }, { status: 400, headers });
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > WEB_CONFIG.maxRequestBytes) {
        await reader.cancel();
        return Response.json({ error: "Запрос превышает допустимый объём." }, { status: 413, headers });
      }
      parts.push(part.value);
    }
  } finally { reader.releaseLock(); }
  let payload: unknown;
  try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts))); }
  catch { return Response.json({ error: "Некорректный JSON запроса." }, { status: 400, headers }); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).some((key) => key !== "baseRef" && key !== "headRef")) {
    return Response.json({ error: "Ожидаются только baseRef и headRef." }, { status: 400, headers });
  }
  const { baseRef, headRef } = payload as Record<string, unknown>;
  if (typeof baseRef !== "string" || !baseRef || typeof headRef !== "string" || !headRef) {
    return Response.json({ error: "Выберите базовую и проверяемую ветки." }, { status: 400, headers });
  }
  return { baseRef, headRef };
}

export async function handleCodeReview(request: Request, root = process.cwd()): Promise<Response> {
  const rejected = validateMcpMutation(request);
  if (rejected) return rejected.status === 403
    ? Response.json({ error: "Запускать ревью можно только с этого сайта." }, { status: 403, headers }) : rejected;
  const input = await readInput(request);
  if (input instanceof Response) return input;
  let baseSha: string;
  let headSha: string;
  try {
    const workspace = await readReviewWorkspace(root, request.signal);
    const base = workspace.branches.find((branch) => branch.ref === input.baseRef);
    const head = workspace.branches.find((branch) => branch.ref === input.headRef);
    if (!base || !head) return Response.json({ error: "Ветка не найдена. Обновите список веток." }, { status: 400, headers });
    baseSha = base.sha; headSha = head.sha;
  } catch (cause) {
    if (request.signal.aborted) return new Response(null, { status: 499, headers });
    console.error("code_review_refs_failed", { error: cause instanceof Error ? cause.name : "UnknownError" });
    return Response.json({ error: "Не удалось прочитать ветки репозитория GitHub на сервере." }, { status: 502, headers });
  }
  const abort = new AbortController();
  const deadline = AbortSignal.timeout(WEB_CONFIG.runTimeoutMs);
  const signal = AbortSignal.any([request.signal, abort.signal, deadline]);
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: CodeReviewEvent) => {
        if (!closed && !abort.signal.aborted && !request.signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      const run = async () => {
        try {
          send({ type: "progress", message: "Собираю diff и изменённые файлы…" });
          const snapshot = await collectReviewSnapshot(root, baseSha, headSha, signal);
          send({ type: "snapshot", snapshot });
          const report = await analyzeReviewSnapshot(root, snapshot, signal, (message) => send({ type: "progress", message }));
          signal.throwIfAborted();
          send({ type: "result", report });
        } catch (cause) {
          if (!abort.signal.aborted && !request.signal.aborted) {
            const message = deadline.aborted ? "Истёк таймаут ревью. Попробуйте проверить меньшую ветку."
              : cause instanceof CodeReviewError ? cause.message : "Ревью не выполнено. Проверьте доступ сервера к Git и модели, затем повторите запуск.";
            console.error("code_review_web_failed", { error: cause instanceof Error ? cause.name : "UnknownError" });
            send({ type: "error", message });
          }
        } finally {
          if (!closed) { closed = true; controller.close(); }
        }
      };
      void run();
    },
    cancel(reason) { closed = true; abort.abort(reason); },
  });
  return new Response(stream, { headers: { ...headers, "Content-Type": "application/x-ndjson; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
}

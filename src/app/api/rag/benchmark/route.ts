import { ChatAgentError } from "@/lib/chat-agent";
import { RagError } from "@/lib/rag-agent";
import { acquireRagBenchmarkLock, configuredRagBenchmark, saveRagBenchmark } from "@/lib/rag-benchmark";
import { RAG_CONFIG } from "@/lib/rag-config";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let release;
  try { release = await acquireRagBenchmarkLock(); }
  catch (error) {
    if (error instanceof RagError) return Response.json({ error: error.message }, { status: error.status });
    console.error({ event: "rag_benchmark_lock_failed", errorName: error instanceof Error ? error.name : "UnknownError" });
    return Response.json({ error: "Не удалось начать сравнение." }, { status: 500 });
  }
  const cancel = new AbortController();
  const signal = AbortSignal.any([request.signal, cancel.signal, AbortSignal.timeout(RAG_CONFIG.benchmarkTimeoutMs)]);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => { if (!signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); };
      try {
        send({ type: "start", total: 10 });
        const report = await configuredRagBenchmark(signal, (item, position) => send({ type: "case", item, position }));
        signal.throwIfAborted();
        await saveRagBenchmark(report);
        send({ type: "complete", report });
      } catch (error) {
        if (!signal.aborted) {
          console.error({ event: "rag_benchmark_failed", errorName: error instanceof Error ? error.name : "UnknownError" });
          const message = error instanceof RagError || (error instanceof ChatAgentError && error.kind === "configuration") ? error.message : "Сравнение прервано: ошибка LLM, таймаут или повреждённый поток. Предыдущий отчёт сохранён.";
          send({ type: "error", error: message });
        }
      } finally {
        await release();
        if (!cancel.signal.aborted) controller.close();
      }
    },
    cancel() { cancel.abort(); },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}

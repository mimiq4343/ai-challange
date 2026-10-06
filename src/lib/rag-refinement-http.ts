import "server-only";
import { ChatAgentError } from "./chat-agent";
import { RagError } from "./rag-agent";
import { RAG_CONFIG } from "./rag-config";
import { parseRefinementSettings, RagRefinementAgent } from "./rag-refinement-agent";
import { acquireRefinementBenchmarkLock, configuredRefinementBenchmark, saveRefinementBenchmark } from "./rag-refinement-benchmark";
import { REFINEMENT_CONFIG } from "./rag-refinement-config";
import { REFINEMENT_QUESTIONS } from "./rag-refinement-questions";
import type { RefinementRequestMode } from "./rag-refinement-types";

const headers = { "Cache-Control": "no-store" };

export async function readPayload(request: Request): Promise<Record<string, unknown>> {
  request.signal.throwIfAborted();
  if (!request.body) throw new RagError("Нужен JSON-запрос.", 400);
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > RAG_CONFIG.maxRequestBytes) { await reader.cancel(); throw new RagError("Запрос превышает допустимый объём.", 413); }
      parts.push(part.value);
    }
  } finally { reader.releaseLock(); }
  request.signal.throwIfAborted();
  let value;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts))); }
  catch (cause) { throw new RagError("Недействительный JSON запроса.", 400, { cause }); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RagError("Нужен JSON-объект.", 400);
  return value;
}

export function failure(error: unknown, request: Request, event: string): Response {
  if (request.signal.aborted) return new Response(null, { status: 499, headers });
  if (error instanceof RagError) {
    if (error.status === 502) console.error({ event, errorName: error.name });
    return Response.json({ error: error.message }, { status: error.status, headers });
  }
  if (error instanceof ChatAgentError && error.kind === "configuration") return Response.json({ error: error.message }, { status: 503, headers });
  console.error({ event, errorName: error instanceof Error ? error.name : "UnknownError" });
  return Response.json({ error: "Обработка прервана: ошибка LLM, таймаут или повреждённый поток." }, { status: 502, headers });
}

export async function refinementResponse(request: Request, createAgent: () => RagRefinementAgent = RagRefinementAgent.fromEnvironment): Promise<Response> {
  try {
    const { question, mode, settings, ...extra } = await readPayload(request);
    if (Object.keys(extra).length || typeof question !== "string" || !question.trim() || question.trim().length > RAG_CONFIG.maxQuestionCharacters ||
      (mode !== "compare" && mode !== "baseline" && mode !== "rewrite" && mode !== "refined")) throw new RagError("Нужны question, mode=baseline|rewrite|refined|compare и settings.", 400);
    const selectedSettings = parseRefinementSettings(settings);
    request.signal.throwIfAborted();
    const answers = await createAgent().respond(question, mode as RefinementRequestMode, selectedSettings, request.signal);
    return Response.json({ question: question.trim(), answers }, { headers });
  } catch (error) { return failure(error, request, "rag_refinement_failed"); }
}

type BenchmarkDependencies = {
  run: typeof configuredRefinementBenchmark;
  save: (report: Awaited<ReturnType<typeof configuredRefinementBenchmark>>, signal: AbortSignal) => Promise<void>;
  lock: typeof acquireRefinementBenchmarkLock;
};

export async function refinementBenchmarkResponse(request: Request, dependencies: BenchmarkDependencies = {
  run: configuredRefinementBenchmark,
  save: (report, signal) => saveRefinementBenchmark(report, REFINEMENT_CONFIG.reportPath, signal),
  lock: acquireRefinementBenchmarkLock,
}): Promise<Response> {
  let settings;
  let release;
  try {
    const payload = await readPayload(request);
    if (Object.keys(payload).length !== 1 || !Object.hasOwn(payload, "settings")) throw new RagError("Нужен JSON только с settings.", 400);
    settings = parseRefinementSettings(payload.settings);
    release = await dependencies.lock();
  } catch (error) { return failure(error, request, "rag_refinement_benchmark_start_failed"); }
  const cancel = new AbortController();
  const signal = AbortSignal.any([request.signal, cancel.signal, AbortSignal.timeout(RAG_CONFIG.benchmarkTimeoutMs)]);
  const encoder = new TextEncoder();
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => { finish = resolve; });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => { if (!signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); };
      try {
        send({ type: "start", total: REFINEMENT_QUESTIONS.length, settings });
        const report = await dependencies.run(settings, signal, (item, position) => send({ type: "case", item, position }));
        signal.throwIfAborted();
        await dependencies.save(report, signal);
        send({ type: "complete", report });
      } catch (error) {
        if (!signal.aborted) {
          console.error({ event: "rag_refinement_benchmark_failed", errorName: error instanceof Error ? error.name : "UnknownError" });
          send({ type: "error", error: error instanceof RagError || (error instanceof ChatAgentError && error.kind === "configuration") ? error.message : "Сравнение прервано: ошибка LLM, таймаут или повреждённый поток. Предыдущий отчёт сохранён." });
        }
      } finally {
        try { await release(); }
        finally { if (!cancel.signal.aborted) controller.close(); finish(); }
      }
    },
    async cancel() { cancel.abort(); await finished; },
  });
  return new Response(stream, { headers: { ...headers, "Content-Type": "application/x-ndjson; charset=utf-8", "X-Accel-Buffering": "no" } });
}

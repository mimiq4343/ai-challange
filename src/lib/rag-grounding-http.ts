import "server-only";
import { ChatAgentError } from "./chat-agent";
import { RagError } from "./rag-agent";
import { RAG_CONFIG } from "./rag-config";
import { GroundedRagAgent } from "./rag-grounding-agent";
import { acquireGroundingBenchmarkLock, configuredGroundingBenchmark, saveGroundingBenchmark } from "./rag-grounding-benchmark";
import { GROUNDING_CONFIG } from "./rag-grounding-config";
import { parseRefinementSettings } from "./rag-refinement-agent";
import { failure, readPayload } from "./rag-refinement-http";
import { REFINEMENT_QUESTIONS } from "./rag-refinement-questions";

const headers = { "Cache-Control": "no-store" };

export async function groundingResponse(request: Request, createAgent: () => GroundedRagAgent = GroundedRagAgent.fromEnvironment): Promise<Response> {
  try {
    const { question, settings, ...extra } = await readPayload(request);
    if (Object.keys(extra).length || typeof question !== "string" || !question.trim() || question.trim().length > RAG_CONFIG.maxQuestionCharacters) throw new RagError("Нужны question и settings; контекст загружается на сервере.", 400);
    const selectedSettings = parseRefinementSettings(settings);
    request.signal.throwIfAborted();
    const answer = await createAgent().respond(question, selectedSettings, request.signal);
    return Response.json({ question: question.trim(), answer }, { headers });
  } catch (error) { return failure(error, request, "rag_grounding_failed"); }
}

type BenchmarkDependencies = {
  run: typeof configuredGroundingBenchmark;
  save: (report: Awaited<ReturnType<typeof configuredGroundingBenchmark>>, signal: AbortSignal) => Promise<void>;
  lock: typeof acquireGroundingBenchmarkLock;
};

export async function groundingBenchmarkResponse(request: Request, dependencies: BenchmarkDependencies = {
  run: configuredGroundingBenchmark,
  save: (report, signal) => saveGroundingBenchmark(report, GROUNDING_CONFIG.reportPath, signal),
  lock: acquireGroundingBenchmarkLock,
}): Promise<Response> {
  let settings;
  let release;
  try {
    const payload = await readPayload(request);
    if (Object.keys(payload).length !== 1 || !Object.hasOwn(payload, "settings")) throw new RagError("Нужен JSON только с settings.", 400);
    settings = parseRefinementSettings(payload.settings);
    request.signal.throwIfAborted();
    release = await dependencies.lock();
  } catch (error) { return failure(error, request, "rag_grounding_benchmark_start_failed"); }
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
          console.error({ event: "rag_grounding_benchmark_failed", errorName: error instanceof Error ? error.name : "UnknownError" });
          send({ type: "error", error: error instanceof RagError || (error instanceof ChatAgentError && error.kind === "configuration") ? error.message : "Проверка прервана: ошибка LLM, таймаут или повреждённый поток. Предыдущий отчёт сохранён." });
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

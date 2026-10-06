import { ChatAgentError } from "../src/lib/chat-agent";
import { RagError } from "../src/lib/rag-agent";
import { RAG_CONFIG } from "../src/lib/rag-config";
import { acquireRefinementBenchmarkLock, configuredRefinementBenchmark, saveRefinementBenchmark } from "../src/lib/rag-refinement-benchmark";
import { REFINEMENT_CONFIG } from "../src/lib/rag-refinement-config";

async function main(): Promise<void> {
  const release = await acquireRefinementBenchmarkLock();
  try {
    const signal = AbortSignal.timeout(RAG_CONFIG.benchmarkTimeoutMs);
    const report = await configuredRefinementBenchmark(REFINEMENT_CONFIG.settings, signal, (item, position) => {
      console.log(JSON.stringify({ position, id: item.question.id, scores: Object.fromEntries(Object.entries(item.judge.scores).map(([mode, scores]) => [mode, scores.overall])), retrievalHits: item.retrievalHits }));
    });
    await saveRefinementBenchmark(report, REFINEMENT_CONFIG.reportPath, signal);
    console.log(JSON.stringify({ saved: REFINEMENT_CONFIG.reportPath, cases: report.cases.length, model: report.model, indexId: report.indexId }));
  } finally { await release(); }
}

main().catch((error) => {
  const message = error instanceof RagError || (error instanceof ChatAgentError && error.kind === "configuration") ? error.message : "Сравнение не выполнено: ошибка сервиса, сети или потока.";
  console.error(JSON.stringify({ error: message, errorName: error instanceof Error ? error.name : "UnknownError" }));
  process.exitCode = 1;
});

import { ChatAgentError } from "../src/lib/chat-agent";
import { RagError } from "../src/lib/rag-agent";
import { RAG_CONFIG } from "../src/lib/rag-config";
import { acquireGroundingBenchmarkLock, configuredGroundingBenchmark, saveGroundingBenchmark } from "../src/lib/rag-grounding-benchmark";
import { GROUNDING_CONFIG } from "../src/lib/rag-grounding-config";
import { REFINEMENT_CONFIG } from "../src/lib/rag-refinement-config";

async function main(): Promise<void> {
  const release = await acquireGroundingBenchmarkLock();
  try {
    const signal = AbortSignal.timeout(RAG_CONFIG.benchmarkTimeoutMs);
    const report = await configuredGroundingBenchmark(REFINEMENT_CONFIG.settings, signal, (item, position) => {
      console.log(JSON.stringify({ position, id: item.question.id, status: item.answer.status, checks: item.checks, unsupportedClaims: item.judge.unsupportedClaims }));
    });
    await saveGroundingBenchmark(report, GROUNDING_CONFIG.reportPath, signal);
    console.log(JSON.stringify({ saved: GROUNDING_CONFIG.reportPath, cases: report.cases.length, model: report.model, indexId: report.indexId }));
  } finally { await release(); }
}

main().catch((error) => {
  const message = error instanceof RagError || (error instanceof ChatAgentError && error.kind === "configuration") ? error.message : "Проверка цитат не выполнена: ошибка сервиса, сети или потока.";
  console.error(JSON.stringify({ error: message, errorName: error instanceof Error ? error.name : "UnknownError" }));
  process.exitCode = 1;
});

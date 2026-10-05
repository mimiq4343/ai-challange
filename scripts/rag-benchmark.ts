import { acquireRagBenchmarkLock, configuredRagBenchmark, saveRagBenchmark } from "../src/lib/rag-benchmark";
import { RAG_CONFIG } from "../src/lib/rag-config";
import { RagError } from "../src/lib/rag-agent";
import { ChatAgentError } from "../src/lib/chat-agent";

async function main(): Promise<void> {
  const release = await acquireRagBenchmarkLock();
  try {
    const report = await configuredRagBenchmark(AbortSignal.timeout(RAG_CONFIG.benchmarkTimeoutMs), (item, position) => {
      const plain = item.labelA === "plain" ? item.judge.a : item.judge.b;
      const rag = item.labelA === "rag" ? item.judge.a : item.judge.b;
      console.log(JSON.stringify({ position, id: item.question.id, plain: plain.overall, rag: rag.overall, retrievalHit: item.retrievalHit }));
    });
    await saveRagBenchmark(report);
    console.log(JSON.stringify({ saved: RAG_CONFIG.reportPath, cases: report.cases.length, model: report.model, indexId: report.indexId }));
  } finally { await release(); }
}

main().catch((error) => {
  const message = error instanceof RagError || (error instanceof ChatAgentError && error.kind === "configuration") ? error.message : "Сравнение не выполнено: ошибка сервиса, сети или потока.";
  console.error(JSON.stringify({ error: message, errorName: error instanceof Error ? error.name : "UnknownError" }));
  process.exitCode = 1;
});

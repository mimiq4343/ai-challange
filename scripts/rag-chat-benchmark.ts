import { mkdir, writeFile } from "node:fs/promises";
import { configuredRagChatBenchmark, saveRagChatBenchmark } from "../src/lib/rag-chat-benchmark";
import { RAG_CHAT_CONFIG } from "../src/lib/rag-chat-config";
import { acquireRefinementBenchmarkLock } from "../src/lib/rag-refinement-benchmark";
import { REFINEMENT_CONFIG } from "../src/lib/rag-refinement-config";
import { RAG_CONFIG } from "../src/lib/rag-config";

async function main() {
  const release = await acquireRefinementBenchmarkLock(RAG_CHAT_CONFIG.lockPath);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(RAG_CONFIG.benchmarkTimeoutMs)]);
  try {
    const report = await configuredRagChatBenchmark(REFINEMENT_CONFIG.settings, signal, (turn, scenario, position) => {
      console.log(`${scenario} ${position}/12: ${turn.answer.status}, sources=${turn.answer.result.sources.length}, goal=${turn.judge.goalRetained}, supported=${turn.judge.supported}`);
    });
    await saveRagChatBenchmark(report, RAG_CHAT_CONFIG.reportPath, signal);
    const directory = ".harness/reports/day-25";
    await mkdir(directory, { recursive: true });
    const all = report.scenarios.flatMap((scenario) => scenario.turns);
    const positive = all.filter((turn) => !turn.expectUnknown);
    const answered = all.filter((turn) => turn.answer.status === "answered");
    const negative = all.filter((turn) => turn.expectUnknown);
    const observations = report.scenarios.flatMap((scenario) => scenario.turns.flatMap((turn, i) =>
      [turn.judge.goalRetained, turn.judge.constraintsRespected, turn.judge.termsCorrect, turn.judge.followsQuestion, turn.judge.supported].every(Boolean)
        ? [] : [`- ${scenario.title}, ход ${i + 1}: ${turn.judge.rationale}`]));
    const rows = report.scenarios.map((scenario) => `- [${scenario.title}](${scenario.id}.md): ${scenario.turns.length} ходов; цель ${scenario.turns.filter((turn) => turn.judge.goalRetained).length}/12; SQLite reopened=${scenario.restoredAfterReopen}.`);
    await writeFile(`${directory}/rag-chat-quality.md`, `# Day 25: два длинных диалога

Сгенерировано: ${report.createdAt}. Модель: ${report.model}.

Индекс: ${report.indexId}; embedding model: ${report.embeddingModel}.
Настройки: candidateK=${report.settings.candidateK}, contextK=${report.settings.contextK}, minRelevance=${report.settings.minRelevance}.
Окно истории: ${report.historyMessages} сообщений; полная история и память остаются в SQLite.

${rows.join("\n")}

На вопросы по корпусу источники: ${positive.filter((turn) => turn.checks.hasSources).length}/${positive.length}.
Цель сохранена по оценке судьи: ${all.filter((turn) => turn.judge.goalRetained).length}/${all.length}.
Значение цели неизменно в памяти: ${all.filter((turn) => turn.checks.stableGoal).length}/${all.length}.
Ограничения соблюдены: ${all.filter((turn) => turn.judge.constraintsRespected).length}/${all.length}.
Термины учтены: ${all.filter((turn) => turn.judge.termsCorrect).length}/${all.length}.
Текущий вопрос учтён: ${all.filter((turn) => turn.judge.followsQuestion).length}/${all.length}.
Дословные цитаты при answered: ${answered.filter((turn) => turn.checks.verbatimQuotes).length}/${answered.length}.
Поддержка смысла цитатами при answered: ${answered.filter((turn) => turn.judge.supported).length}/${answered.length}.
Корректные отказы вне корпуса: ${negative.filter((turn) => turn.checks.expectedStatus && !turn.checks.hasSources && !turn.answer.quotes.length).length}/${negative.length}.
Ожидаемый answered/unknown: ${all.filter((turn) => turn.checks.expectedStatus).length}/${all.length}.

Оценки смысла ориентировочные: та же модель отвечает и оценивает. Дословность цитат и восстановление SQLite проверяются программно. Индекс используется без подмешивания эталонов; слабый поиск может дать честный отказ на вопрос по корпусу.

Полный локальный JSON: data/rag-chat-quality.json; сценарии ниже содержат все ответы, снимки памяти, источники и цитаты.

Замечания судьи:

${observations.join("\n") || "Не отмечены."}
`, "utf8");
    for (const scenario of report.scenarios) {
      const body = scenario.turns.map((turn, i) => `## Ход ${i + 1}

Пользователь: ${turn.content}

Статус: ${turn.answer.status}. Запрос поиска: ${turn.answer.query}.

${turn.answer.result.answer}

Память задачи:

\`\`\`json
${JSON.stringify(turn.taskState, null, 2)}
\`\`\`

Источники:

${turn.answer.result.sources.map((source) => `- [${source.id}] ${source.source} · ${source.section} · строки ${source.startLine}–${source.endLine} · chunkId=${source.chunkId}`).join("\n") || "Нет подтверждающих источников."}

Цитаты:

${turn.answer.quotes.map((quote) => `[${quote.sourceId}]\n\n${quote.text.split("\n").map((line) => line ? `> ${line}` : ">").join("\n")}`).join("\n\n") || "Нет цитат."}

Проверка: ${JSON.stringify(turn.checks)}.
Судья: ${JSON.stringify(turn.judge)}.
Provider tokens (ответ + память + поиск + судья): ${turn.usage.totalTokens}.
`);
      await writeFile(`${directory}/${scenario.id}.md`, `# ${scenario.title}\n\nСгенерировано автоматически; ${report.createdAt}.\nЦель: ${scenario.goal}.\n\n${body.join("\n").trimEnd()}\n`, "utf8");
    }
    console.log(`Полный отчёт: ${RAG_CHAT_CONFIG.reportPath}; Markdown: ${directory}/rag-chat-quality.md`);
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await release();
  }
}

main().catch((error) => {
  console.error({ event: "rag_chat_benchmark_failed", errorName: error instanceof Error ? error.name : "UnknownError", message: error instanceof Error ? error.message : "Не удалось выполнить проверку" });
  process.exitCode = 1;
});

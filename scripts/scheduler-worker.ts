import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { ChatAgentError } from "../src/lib/chat-agent";
import { SCHEDULER_LIMITS } from "../src/lib/scheduler-config";
import { SqliteSchedulerStore } from "../src/lib/scheduler-store";
import { createSchedulerSummarizer } from "../src/lib/scheduler-summary";
import { runSchedulerOnce } from "../src/lib/scheduler-worker";

async function main(): Promise<void> {
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let store: SqliteSchedulerStore | undefined;
  try {
    store = new SqliteSchedulerStore(join(process.cwd(), "data", "chat.sqlite"));
    const summarize = createSchedulerSummarizer();
    console.log("scheduler_worker_started");
    while (!shutdown.signal.aborted) {
      // Один запуск за раз: ни параллельных интервалов, ни повторов при ошибке API.
      const claimed = await runSchedulerOnce(store, { summarize }, shutdown.signal);
      if (!claimed) await delay(SCHEDULER_LIMITS.pollIntervalMs, undefined, { signal: shutdown.signal });
    }
  } catch (error) {
    if (!shutdown.signal.aborted) throw error;
  } finally {
    store?.close();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

void main().catch((error: unknown) => {
  const configuration = error instanceof ChatAgentError && error.kind === "configuration";
  console.error("scheduler_worker_failed", {
    error: configuration ? "configuration" : "unexpected",
    message: configuration
      ? "Проверьте OPENAI_BASE_URL, OPENAI_API_KEY и OPENAI_MODEL перед запуском worker."
      : "Worker остановлен из-за внутренней ошибки. Текст внешнего ответа не логируется.",
  });
  process.exitCode = 1;
});

import { ChatAgentError } from "./chat-agent";
import { fetchGitHubRepository, GitHubRepositoryError, type GitHubRepositoryInfo } from "./github-repository-tool";
import { SCHEDULER_LIMITS } from "./scheduler-config";
import type { SqliteSchedulerStore } from "./scheduler-store";
import { createSchedulerSummarizer, SchedulerSummaryError } from "./scheduler-summary";
import type { ScheduleAggregate } from "./scheduler-types";

export type SchedulerWorkerDependencies = {
  fetchRepository(input: { owner: string; repo: string }, signal: AbortSignal): Promise<GitHubRepositoryInfo>;
  summarize(aggregate: ScheduleAggregate, signal: AbortSignal): Promise<string>;
  now(): number;
};

export async function runSchedulerOnce(
  store: SqliteSchedulerStore,
  dependencies: Partial<SchedulerWorkerDependencies> = {},
  callerSignal?: AbortSignal,
): Promise<boolean> {
  if (callerSignal?.aborted) return false;
  const fetchRepository = dependencies.fetchRepository ?? fetchGitHubRepository;
  const summarize = dependencies.summarize ?? createSchedulerSummarizer();
  const now = dependencies.now ?? Date.now;
  const claim = store.claimDue(now());
  if (!claim) return false;

  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new Error("Истёк срок запуска мониторинга.")), SCHEDULER_LIMITS.runTimeoutMs);
  const signal = callerSignal ? AbortSignal.any([callerSignal, deadline.signal]) : deadline.signal;
  let abort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  let aggregate: ScheduleAggregate | null = null;
  try {
    signal.throwIfAborted();
    const run = store.getClaimRun(claim, now());
    if (!run) return true;
    if (!run.sample) {
      const repository = await Promise.race([
        fetchRepository({ owner: claim.job.owner, repo: claim.job.repo }, signal), aborted,
      ]);
      signal.throwIfAborted();
      // Отдельная фиксация: потеря LLM или SIGTERM не уничтожают уже собранный замер.
      if (!store.saveSample(claim, repository, now())) return true;
    }
    if (!store.getClaimRun(claim, now())) return true;
    aggregate = store.getSummary(claim.job.profileId, claim.job.id, SCHEDULER_LIMITS.defaultPeriodHours, now());
    if (!aggregate || !store.getClaimRun(claim, now())) return true;
    signal.throwIfAborted();
    const summary = await Promise.race([summarize(aggregate, signal), aborted]);
    signal.throwIfAborted();
    if (!summary.trim() || Buffer.byteLength(summary, "utf8") > SCHEDULER_LIMITS.summaryMaxBytes) {
      throw new SchedulerSummaryError("DeepSeek вернул пустую или слишком длинную сводку.");
    }
    store.complete(claim, { summary: summary.trim(), aggregate, error: null }, now());
  } catch (cause) {
    if (callerSignal?.aborted) {
      store.releaseClaim(claim, now());
      return true;
    }
    let error: string;
    let expected = true;
    if (deadline.signal.aborted) {
      error = "Мониторинг не завершился за 90 секунд. Следующая попытка — по расписанию.";
    } else if (cause instanceof GitHubRepositoryError) {
      error = `Не удалось собрать данные GitHub (${cause.code}). Следующая попытка — по расписанию.`;
    } else if (cause instanceof SchedulerSummaryError) {
      error = cause.message;
    } else if (cause instanceof ChatAgentError) {
      error = cause.kind === "configuration" ? "Некорректная конфигурация DeepSeek." : "DeepSeek недоступен; собранный замер сохранён.";
    } else {
      expected = false;
      error = "Внутренняя ошибка worker; запуск не завершён.";
    }
    store.complete(claim, { summary: null, aggregate, error }, now());
    // Неожиданная ошибка логируется ровно на границе процесса, без текста ответа API.
    if (!expected) throw cause;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    deadline.abort();
  }
  return true;
}

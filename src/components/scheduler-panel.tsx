"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ClockCountdownIcon } from "@phosphor-icons/react";

import { SCHEDULER_LIMITS } from "@/lib/scheduler-config";
import type { ScheduleAggregate, ScheduleJob, ScheduleRun, SchedulerSnapshot } from "@/lib/scheduler-types";

const BUTTON_CLASS =
  "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line px-3 py-2 text-xs font-medium transition-colors hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-40";
const DETAILS_CLASS =
  "min-h-11 cursor-pointer rounded-lg py-3 text-xs font-medium text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const RUN_LABEL: Record<ScheduleRun["status"], string> = {
  running: "Выполняется",
  completed: "Готово",
  failed: "Ошибка",
  cancelled: "Отменён",
};
const subscribeHydration = () => () => {};

async function readResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      payload && typeof payload === "object" && typeof payload.error === "string"
        ? payload.error : `Сервер вернул ${response.status}.`,
    );
  }
  if (payload === null) throw new Error("Сервер вернул некорректный ответ.");
  return payload as T;
}

function Timestamp({ value, local }: { value: string; local: boolean }) {
  return (
    <time dateTime={value} title={value} className="[overflow-wrap:anywhere]">
      {local
        ? new Date(value).toLocaleString("ru-RU", {
            day: "2-digit", month: "2-digit", year: "numeric",
            hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short",
          })
        : `${value.replace("T", " ").replace(/\.\d{3}Z$/, "")} UTC`}
    </time>
  );
}

function delta(value: number | null): string {
  return value === null ? "нет данных" : value > 0 ? `+${value}` : String(value);
}

function Aggregate({ value, local }: { value: ScheduleAggregate; local: boolean }) {
  return (
    <div className="space-y-2 text-xs leading-relaxed">
      <p className="text-muted">
        <Timestamp value={value.from} local={local} /> — <Timestamp value={value.to} local={local} />
      </p>
      <p>Замеров: {value.sampleCount}. Ошибок запусков: {value.failedRuns}.</p>
      {value.sampleCount === 0 ? (
        <p className="text-muted">В этом периоде ещё нет данных GitHub.</p>
      ) : value.sampleCount === 1 ? (
        <p className="text-muted">Базовый замер: второго замера пока нет, изменение ещё неизвестно.</p>
      ) : (
        <p className="text-muted">Изменение между первым и последним замером в выбранном периоде.</p>
      )}
      <dl className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-background p-3">
        <div><dt className="text-muted">Звёзды, изменение</dt><dd className="mt-1 font-mono">{delta(value.starsChange)}</dd></div>
        <div><dt className="text-muted">Форки, изменение</dt><dd className="mt-1 font-mono">{delta(value.forksChange)}</dd></div>
      </dl>
      {value.latest && (
        <p className="text-muted">
          Последний замер: {value.latest.repository.stars} звёзд, {value.latest.repository.forks} форков.
        </p>
      )}
    </div>
  );
}

function RunCard({ run, job, local }: { run: ScheduleRun; job: ScheduleJob | undefined; local: boolean }) {
  return (
    <article className="min-w-0 space-y-3 rounded-xl border border-line bg-background p-3 [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="min-w-0 text-sm font-semibold">{job ? `${job.owner}/${job.repo}` : "Репозиторий"}</h4>
        <span className={`rounded-full border px-2 py-1 text-xs ${run.status === "failed" ? "border-red-400/30 text-red-300" : "border-line text-muted"}`}>
          {RUN_LABEL[run.status]}
        </span>
      </div>
      <p className="text-xs text-muted">Начало: <Timestamp value={run.startedAt} local={local} /></p>
      {run.summary && <p className="whitespace-pre-wrap text-sm leading-relaxed">{run.summary}</p>}
      {run.error && <p className="rounded-lg border border-red-400/25 bg-red-400/5 p-3 text-xs leading-relaxed text-red-300">{run.error}</p>}
      {!run.summary && (
        <p className="text-xs leading-relaxed text-muted">
          {run.status === "running"
            ? "Worker выполняет запуск. Сводка появится здесь после завершения."
            : run.sample
              ? "Замер GitHub сохранён, но текстовая сводка не создана. Данные доступны ниже."
              : "В этом запуске нет сохранённого замера GitHub или сводки."}
        </p>
      )}
      {run.aggregate && <Aggregate value={run.aggregate} local={local} />}
      {run.sample && (
        <details className="min-w-0 border-t border-line">
          <summary className={DETAILS_CLASS}>Данные GitHub и время запуска</summary>
          <dl className="space-y-2 pb-2 text-xs leading-relaxed">
            <div><dt className="text-muted">Замер</dt><dd><Timestamp value={run.sample.collectedAt} local={local} /></dd></div>
            <div><dt className="text-muted">Звёзды / форки</dt><dd>{run.sample.repository.stars} / {run.sample.repository.forks}</dd></div>
            <div><dt className="text-muted">Язык</dt><dd>{run.sample.repository.language ?? "Не указан"}</dd></div>
            <div><dt className="text-muted">Описание</dt><dd>{run.sample.repository.description ?? "Не указано"}</dd></div>
            <div><dt className="text-muted">Запланирован</dt><dd><Timestamp value={run.scheduledFor} local={local} /></dd></div>
            {run.finishedAt && <div><dt className="text-muted">Завершён</dt><dd><Timestamp value={run.finishedAt} local={local} /></dd></div>}
          </dl>
        </details>
      )}
    </article>
  );
}

export function SchedulerPanel({
  initialSnapshot, profileId, profileName,
}: {
  initialSnapshot: SchedulerSnapshot;
  profileId: number;
  profileName: string;
}) {
  const router = useRouter();
  const headingId = useId();
  const local = useSyncExternalStore(subscribeHydration, () => true, () => false);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [profileChanged, setProfileChanged] = useState(false);
  const [pendingStop, setPendingStop] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [summaries, setSummaries] = useState<Record<string, ScheduleAggregate>>({});
  const [summaryErrors, setSummaryErrors] = useState<Record<string, string>>({});
  const [pendingSummaries, setPendingSummaries] = useState<string[]>([]);
  const panelRef = useRef<HTMLElement>(null);
  const pollRef = useRef<AbortController | null>(null);
  const mutationRef = useRef<AbortController | null>(null);
  const summaryRefs = useRef(new Map<string, AbortController>());
  const refreshRef = useRef<(() => void) | null>(null);
  const revisionRef = useRef(0);
  const changedProfileRef = useRef(false);

  const acceptsProfile = useCallback((response: Response) => {
    const activeProfile = response.headers.get("X-Flash-Profile-Id");
    if (activeProfile === null || activeProfile === String(profileId)) return !changedProfileRef.current;
    if (!changedProfileRef.current) {
      changedProfileRef.current = true;
      pollRef.current?.abort();
      mutationRef.current?.abort();
      for (const controller of summaryRefs.current.values()) controller.abort();
      setProfileChanged(true);
      setSnapshot({ jobs: [], runs: [] });
      setSummaries({});
      router.refresh();
    }
    return false;
  }, [profileId, router]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    let disposed = false;
    let inView = false;
    let timer: number | undefined;
    const visible = () => !disposed && inView && document.visibilityState === "visible" && !changedProfileRef.current;
    function scheduleNext() {
      window.clearTimeout(timer);
      if (visible()) timer = window.setTimeout(() => { void refresh(); }, SCHEDULER_LIMITS.pollIntervalMs);
    }
    async function refresh() {
      if (!visible() || pollRef.current) return;
      window.clearTimeout(timer);
      const controller = new AbortController();
      const revision = revisionRef.current;
      pollRef.current = controller;
      try {
        const response = await fetch("/api/schedules", { cache: "no-store", signal: controller.signal });
        if (controller.signal.aborted || !acceptsProfile(response)) return;
        const result = await readResponse<SchedulerSnapshot>(response);
        if (!controller.signal.aborted && revision === revisionRef.current) {
          setSnapshot(result);
          setFeedError(null);
          setLastChecked(new Date().toISOString());
        }
      } catch (error) {
        if (!controller.signal.aborted) setFeedError(error instanceof Error ? error.message : "Не удалось обновить мониторинг.");
      } finally {
        if (pollRef.current === controller) pollRef.current = null;
        scheduleNext();
      }
    }
    function visibilityChanged() {
      if (visible()) void refresh();
      else {
        window.clearTimeout(timer);
        pollRef.current?.abort();
      }
    }
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      visibilityChanged();
    });
    observer.observe(panel);
    document.addEventListener("visibilitychange", visibilityChanged);
    refreshRef.current = () => { void refresh(); };
    const summariesInFlight = summaryRefs.current;
    return () => {
      disposed = true;
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.clearTimeout(timer);
      pollRef.current?.abort();
      pollRef.current = null;
      mutationRef.current?.abort();
      for (const controller of summariesInFlight.values()) controller.abort();
      summariesInFlight.clear();
      refreshRef.current = null;
    };
  }, [acceptsProfile]);

  async function stop(job: ScheduleJob) {
    if (job.status === "stopped" || mutationRef.current || changedProfileRef.current) return;
    const controller = new AbortController();
    mutationRef.current = controller;
    revisionRef.current += 1;
    setPendingStop(job.id);
    setMutationError(null);
    setNotice("");
    try {
      const response = await fetch(`/api/schedules/${job.id}/stop`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: controller.signal,
      });
      if (controller.signal.aborted || !acceptsProfile(response)) return;
      const result = await readResponse<{ job: ScheduleJob }>(response);
      if (controller.signal.aborted) return;
      revisionRef.current += 1;
      setSnapshot((current) => ({ ...current, jobs: current.jobs.map((item) => item.id === result.job.id ? result.job : item) }));
      setNotice(`Мониторинг ${job.owner}/${job.repo} остановлен. Сохранённые результаты остаются в ленте.`);
    } catch (error) {
      if (!controller.signal.aborted) setMutationError(error instanceof Error ? error.message : "Не удалось остановить расписание.");
    } finally {
      if (mutationRef.current === controller) {
        mutationRef.current = null;
        if (!controller.signal.aborted) setPendingStop(null);
        refreshRef.current?.();
      }
    }
  }

  async function loadSummary(jobId: string) {
    if (summaryRefs.current.has(jobId) || changedProfileRef.current) return;
    const controller = new AbortController();
    summaryRefs.current.set(jobId, controller);
    setPendingSummaries((current) => [...current, jobId]);
    setSummaryErrors((current) => ({ ...current, [jobId]: "" }));
    try {
      const response = await fetch(`/api/schedules/${jobId}/summary?periodHours=${SCHEDULER_LIMITS.defaultPeriodHours}`, {
        cache: "no-store", signal: controller.signal,
      });
      if (controller.signal.aborted || !acceptsProfile(response)) return;
      const result = await readResponse<ScheduleAggregate>(response);
      if (!controller.signal.aborted) setSummaries((current) => ({ ...current, [jobId]: result }));
    } catch (error) {
      if (!controller.signal.aborted) setSummaryErrors((current) => ({
        ...current, [jobId]: error instanceof Error ? error.message : "Не удалось получить сводку.",
      }));
    } finally {
      if (summaryRefs.current.get(jobId) === controller) {
        summaryRefs.current.delete(jobId);
        if (!controller.signal.aborted) setPendingSummaries((current) => current.filter((id) => id !== jobId));
      }
    }
  }

  const activeCount = snapshot.jobs.filter((job) => job.status === "active").length;
  const jobsById = new Map(snapshot.jobs.map((job) => [job.id, job]));

  return (
    <section ref={panelRef} aria-labelledby={headingId} className="min-w-0 space-y-4 border-b border-line p-4 [overflow-wrap:anywhere]">
      <header className="flex items-start gap-3">
        <ClockCountdownIcon size={22} className="mt-1 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-accent">Автономный агент</p>
          <h2 id={headingId} className="mt-1 text-base font-semibold">Мониторинг GitHub</h2>
          <p className="mt-1 text-xs text-muted">Профиль: {profileName}</p>
        </div>
      </header>
      <p className="text-xs leading-relaxed text-muted">
        Создайте расписание в чате. Отдельный worker сразу соберёт базовый замер, а затем будет получать данные GitHub
        и готовить сводки через DeepSeek по расписанию — даже если закрыть страницу.
      </p>
      <div className="rounded-xl border border-accent/20 bg-accent/5 p-3 text-xs leading-relaxed">
        <p>Первый запуск — сразу. Интервал — от {SCHEDULER_LIMITS.minIntervalMinutes} минут. До {SCHEDULER_LIMITS.maxActiveJobs} активных расписаний на весь сервер.</p>
        <p className="mt-2 text-muted">Защищённый MCP уже настроен на сервере: вручную добавлять адрес или токен не нужно.</p>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        Отмена или ошибка ответа в чате не удаляет уже созданное расписание. Перед повтором команды проверьте список ниже.
        Чтобы изменить интервал, остановите расписание и создайте новое.
      </p>
      {profileChanged ? (
        <p role="status" className="text-sm text-accent">Активный профиль изменился. Загружаем его расписания…</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Расписания · активных {activeCount}</h3>
            <button type="button" className={BUTTON_CLASS} onClick={() => refreshRef.current?.()}>Обновить</button>
          </div>
          <p className="text-xs leading-relaxed text-muted">
            Лента проверяется каждые 5 секунд, пока панель видна. Это не частота замеров GitHub.
            {lastChecked && <> Проверено: <Timestamp value={lastChecked} local={local} />.</>}
            {" "}{local ? "Время показано в вашем часовом поясе; точный UTC — в подсказке даты." : "Время в UTC."}
          </p>
          {feedError && <p role="alert" className="text-xs leading-relaxed text-red-300">Не удалось обновить ленту: {feedError} Показаны последние полученные данные.</p>}
          {mutationError && <p role="alert" className="text-xs leading-relaxed text-red-300">Остановка не подтверждена: {mutationError}</p>}
          <p role="status" className="text-xs leading-relaxed text-accent">{notice}</p>
          {snapshot.jobs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line p-4 text-sm leading-relaxed text-muted">
              Расписаний пока нет. Напишите в чате: «Следи за vercel/next.js каждый час».
            </div>
          ) : (
            <div className="space-y-3">
              {snapshot.jobs.map((job) => (
                <article key={job.id} className="min-w-0 space-y-3 rounded-xl border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="min-w-0 text-sm font-semibold">{job.owner}/{job.repo}</h4>
                    <span className={`rounded-full border px-2 py-1 text-xs ${job.status === "active" ? "border-accent/30 text-accent" : "border-line text-muted"}`}>
                      {job.status === "active" ? "Активно" : "Остановлено"}
                    </span>
                  </div>
                  <dl className="space-y-2 text-xs leading-relaxed">
                    <div><dt className="text-muted">Интервал</dt><dd>{job.intervalMinutes} мин.</dd></div>
                    <div><dt className="text-muted">Следующий запуск</dt><dd>{job.nextRunAt ? <Timestamp value={job.nextRunAt} local={local} /> : "Не запланирован"}</dd></div>
                    <div><dt className="text-muted">Последний запуск</dt><dd>{job.lastRunAt ? <Timestamp value={job.lastRunAt} local={local} /> : "Ещё не запускался — ожидает worker"}</dd></div>
                  </dl>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={BUTTON_CLASS} aria-label={`Сводка за 24 часа: ${job.owner}/${job.repo}`}
                      aria-disabled={pendingSummaries.includes(job.id)} onClick={() => { void loadSummary(job.id); }}>
                      {pendingSummaries.includes(job.id) ? "Загружаем…" : "Сводка за 24 часа"}
                    </button>
                    <button type="button" className={BUTTON_CLASS} aria-label={`Остановить мониторинг ${job.owner}/${job.repo}`}
                      aria-disabled={job.status === "stopped" || pendingStop !== null} onClick={() => { void stop(job); }}>
                      {pendingStop === job.id ? "Останавливаем…" : job.status === "stopped" ? "Остановлено" : "Остановить"}
                    </button>
                  </div>
                  {summaryErrors[job.id] && <p role="alert" className="text-xs text-red-300">{summaryErrors[job.id]}</p>}
                  {summaries[job.id] && <Aggregate value={summaries[job.id]} local={local} />}
                  <details className="min-w-0 border-t border-line">
                    <summary className={DETAILS_CLASS}>Идентификатор и создание</summary>
                    <p className="pb-2 font-mono text-xs [overflow-wrap:anywhere]">{job.id}</p>
                    <p className="pb-2 text-xs text-muted"><Timestamp value={job.createdAt} local={local} /></p>
                  </details>
                </article>
              ))}
            </div>
          )}
          <div className="space-y-3 border-t border-line pt-4">
            <h3 className="text-sm font-semibold">Фоновые результаты</h3>
            <p className="text-xs leading-relaxed text-muted">Последние {SCHEDULER_LIMITS.feedLimit} запусков профиля. Это отдельная лента, не сообщения в диалоге.</p>
            {snapshot.runs.length === 0
              ? <p className="text-sm text-muted">Результатов пока нет. Первый замер станет точкой отсчёта; изменение появится после следующего.</p>
              : snapshot.runs.map((run) => <RunCard key={run.id} run={run} job={jobsById.get(run.jobId)} local={local} />)}
          </div>
        </>
      )}
    </section>
  );
}

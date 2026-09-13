"use client";

import { useRef, useState } from "react";
import { PaperPlaneRight, Stop } from "@phosphor-icons/react";
import { DAY5_MODELS, DAY5_TASKS, verifyAnswer, type Task } from "@/lib/day5";
import { runJudge, runModel } from "@/lib/day5-runner";
import { Day5Summary } from "./day5-summary";
import { IDLE_RUN, ModelColumn, type ModelRun } from "./model-column";

const CUSTOM_TASK_ID = "custom";
const JUDGE_LABELS = ["A", "B", "C"];

function idleRuns(): ModelRun[] {
  return DAY5_MODELS.map(() => IDLE_RUN);
}

/** Перемешивает индексы, чтобы судья не мог связать метку с классом модели. */
function shuffledIndexes(length: number): number[] {
  const order = Array.from({ length }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export function Day5Lab() {
  const [taskId, setTaskId] = useState<string>(DAY5_TASKS[0].id);
  const [customPrompt, setCustomPrompt] = useState("");
  const [customExpected, setCustomExpected] = useState("");
  const [running, setRunning] = useState(false);
  const [judging, setJudging] = useState(false);
  const [judgeError, setJudgeError] = useState<string | null>(null);
  const [judgeVerdict, setJudgeVerdict] = useState<string>("");
  const [runs, setRuns] = useState<ModelRun[]>(idleRuns);
  const [ranTask, setRanTask] = useState<Task | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const preset = DAY5_TASKS.find((task) => task.id === taskId) ?? null;
  const canRun = !running && (preset !== null || customPrompt.trim().length > 0);
  const finished =
    ranTask !== null && !running && runs.every((run) => run.status === "done" || run.status === "error");

  function patch(index: number, next: (prev: ModelRun) => ModelRun) {
    setRuns((prev) => prev.map((run, i) => (i === index ? next(run) : run)));
  }

  async function runOne(task: Task, index: number, signal: AbortSignal): Promise<string> {
    patch(index, () => ({ ...IDLE_RUN, status: "running" }));
    try {
      const { text, metrics } = await runModel(DAY5_MODELS[index], task, signal, (chunk) =>
        patch(index, (prev) => ({ ...prev, text: prev.text + chunk })),
      );
      const { answer, verdict } =
        task.accept.length > 0 ? verifyAnswer(text, task.accept) : { answer: null, verdict: null };
      patch(index, (prev) => ({ ...prev, status: "done", metrics, answer, verdict }));
      return text;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        patch(index, (prev) => ({ ...prev, status: "done" }));
        return "";
      }
      patch(index, (prev) => ({
        ...prev,
        status: "error",
        error: err instanceof Error ? err.message : "Неизвестная ошибка.",
      }));
      return "";
    }
  }

  async function judge(task: Task, texts: string[], signal: AbortSignal) {
    const order = shuffledIndexes(texts.length);
    const samples = order
      .map((modelIndex, position) => ({
        modelIndex,
        id: JUDGE_LABELS[position],
        text: texts[modelIndex],
      }))
      .filter((sample) => sample.text.trim().length > 0);
    if (samples.length < 2) return;

    setJudging(true);
    try {
      const result = await runJudge(task.prompt, samples, signal);
      setRuns((prev) =>
        prev.map((run, index) => {
          const sample = samples.find((s) => s.modelIndex === index);
          if (!sample) return run;
          return { ...run, judgeLabel: sample.id, score: result.scores[sample.id] ?? null };
        }),
      );
      setJudgeVerdict(result.verdict);
      if (Object.keys(result.scores).length === 0) {
        setJudgeError("Судья вернул ответ, который не удалось разобрать как JSON.");
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setJudgeError(err instanceof Error ? err.message : "Судья не ответил.");
      }
    } finally {
      setJudging(false);
    }
  }

  async function run() {
    if (!canRun) return;
    const task: Task = preset
      ? { prompt: preset.prompt, accept: preset.accept }
      : {
          prompt: customPrompt.trim(),
          accept: customExpected.trim() ? [customExpected.trim()] : [],
        };

    setRuns(idleRuns());
    setJudgeError(null);
    setJudgeVerdict("");
    setRanTask(task);
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;

    // Три модели идут параллельно: так замер времени у каждой честный, а ждать
    // приходится столько, сколько работает самая медленная.
    const texts = new Array<string>(DAY5_MODELS.length).fill("");
    await Promise.allSettled(
      DAY5_MODELS.map(async (_, index) => {
        texts[index] = await runOne(task, index, controller.signal);
      }),
    );
    setRunning(false);
    abortRef.current = null;

    await judge(task, texts, controller.signal);
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap gap-2">
          {DAY5_TASKS.map((task) => (
            <button
              key={task.id}
              type="button"
              onClick={() => setTaskId(task.id)}
              className={`rounded-xl border px-3 py-2 text-left text-xs transition-colors active:scale-[0.98] ${
                taskId === task.id
                  ? "border-accent/50 bg-accent/10 text-foreground"
                  : "border-line text-muted hover:border-accent/30 hover:text-foreground"
              }`}
            >
              <span className="block font-semibold">{task.title}</span>
              <span className="block text-[11px] text-muted">{task.kind}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setTaskId(CUSTOM_TASK_ID)}
            className={`rounded-xl border px-3 py-2 text-left text-xs transition-colors active:scale-[0.98] ${
              taskId === CUSTOM_TASK_ID
                ? "border-accent/50 bg-accent/10 text-foreground"
                : "border-line text-muted hover:border-accent/30 hover:text-foreground"
            }`}
          >
            <span className="block font-semibold">Свой запрос</span>
            <span className="block text-[11px] text-muted">эталон по желанию</span>
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex-1">
            {preset ? (
              <>
                <p className="text-sm leading-relaxed">{preset.prompt}</p>
                <p className="mt-2 text-xs text-muted">
                  {preset.expected ? (
                    <>
                      Эталонный ответ: <span className="font-mono text-foreground">{preset.expected}</span>
                    </>
                  ) : (
                    "У задачи нет одного верного ответа — качество оценивает слепой судья."
                  )}
                </p>
              </>
            ) : (
              <div className="flex flex-col gap-2">
                <textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  rows={3}
                  placeholder="Запрос, который уйдёт на все три модели"
                  aria-label="Свой запрос"
                  className="w-full resize-y rounded-xl border border-line bg-background px-3 py-2 text-sm leading-relaxed placeholder:text-muted/70 focus:border-accent/50 focus:outline-none"
                />
                <input
                  value={customExpected}
                  onChange={(e) => setCustomExpected(e.target.value)}
                  placeholder="Эталонный ответ, если он есть (необязательно)"
                  aria-label="Эталонный ответ"
                  className="w-full rounded-xl border border-line bg-background px-3 py-2 text-sm placeholder:text-muted/70 focus:border-accent/50 focus:outline-none"
                />
              </div>
            )}
          </div>

          {running ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="flex h-11 shrink-0 items-center gap-2 rounded-xl border border-line px-4 text-sm font-semibold transition-colors hover:bg-white/5 active:scale-[0.98]"
            >
              <Stop size={16} weight="fill" />
              Остановить
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void run()}
              disabled={!canRun}
              className="flex h-11 shrink-0 items-center gap-2 rounded-xl bg-accent-deep px-4 text-sm font-semibold text-white transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.98]"
            >
              <PaperPlaneRight size={16} weight="fill" />
              Запустить на {DAY5_MODELS.length} моделях
            </button>
          )}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {DAY5_MODELS.map((spec, index) => (
          <ModelColumn
            key={spec.id}
            spec={spec}
            run={runs[index]}
            highlight={{
              fastest: finished && isBest(runs, index, (m) => -m.totalMs),
              cheapest: finished && isBest(runs, index, (m) => -m.costUsd),
              bestJudged:
                runs[index].score !== null &&
                isBestScore(runs, index),
            }}
          />
        ))}
      </div>

      {judging && <p className="text-sm text-muted">Судья читает три ответа…</p>}
      {judgeError && <p className="text-sm text-amber-300">Оценка судьи недоступна: {judgeError}</p>}

      {finished && (
        <Day5Summary
          runs={runs}
          hasReference={(ranTask?.accept.length ?? 0) > 0}
          judgeVerdict={judgeVerdict}
        />
      )}
    </div>
  );
}

/** Лучшая колонка по метрике: сравниваем только завершившиеся прогоны. */
function isBest(runs: ModelRun[], index: number, score: (metrics: NonNullable<ModelRun["metrics"]>) => number) {
  const current = runs[index].metrics;
  if (!current) return false;
  return runs.every((run) => !run.metrics || score(run.metrics) <= score(current));
}

function isBestScore(runs: ModelRun[], index: number) {
  const current = runs[index].score;
  if (!current) return false;
  const value = current.correctness + current.usefulness;
  return runs.every((run) => !run.score || run.score.correctness + run.score.usefulness <= value);
}

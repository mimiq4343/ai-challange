"use client";

import { useRef, useState } from "react";
import { PaperPlaneRight, Stop } from "@phosphor-icons/react";
import {
  DAY4_TASKS,
  DAY4_TEMPERATURES,
  SAMPLES_PER_TEMPERATURE,
  diversityStats,
  sampleId,
  verifyAnswer,
  type DiversityStats,
  type Task,
} from "@/lib/day4";
import { runJudge, runSample } from "@/lib/day4-runner";
import { IDLE_SAMPLE, TemperatureColumn, type SampleState } from "./temperature-column";
import { TemperatureSummary } from "./temperature-summary";

const CUSTOM_TASK_ID = "custom";
const TOTAL_SAMPLES = DAY4_TEMPERATURES.length * SAMPLES_PER_TEMPERATURE;

function idleGrid(): SampleState[][] {
  return DAY4_TEMPERATURES.map(() => Array.from({ length: SAMPLES_PER_TEMPERATURE }, () => IDLE_SAMPLE));
}

export function TemperatureLab() {
  const [taskId, setTaskId] = useState<string>(DAY4_TASKS[0].id);
  const [customPrompt, setCustomPrompt] = useState("");
  const [customExpected, setCustomExpected] = useState("");
  const [running, setRunning] = useState(false);
  const [judgeError, setJudgeError] = useState<string | null>(null);
  const [grid, setGrid] = useState<SampleState[][]>(idleGrid);
  const [ranTask, setRanTask] = useState<Task | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const preset = DAY4_TASKS.find((t) => t.id === taskId) ?? null;
  const canRun = !running && (preset !== null || customPrompt.trim().length > 0);
  const finished =
    ranTask !== null && grid.every((column) => column.every((s) => s.status === "done" || s.status === "error"));

  function patch(temperatureIndex: number, sampleIndex: number, next: (prev: SampleState) => SampleState) {
    setGrid((prev) =>
      prev.map((column, t) =>
        t === temperatureIndex ? column.map((s, i) => (i === sampleIndex ? next(s) : s)) : column,
      ),
    );
  }

  async function runOne(
    task: Task,
    temperatureIndex: number,
    sampleIndex: number,
    signal: AbortSignal,
  ): Promise<string> {
    const started = performance.now();
    patch(temperatureIndex, sampleIndex, () => ({ ...IDLE_SAMPLE, status: "running" }));
    try {
      const text = await runSample(
        task,
        DAY4_TEMPERATURES[temperatureIndex].value,
        signal,
        (chunk) => patch(temperatureIndex, sampleIndex, (prev) => ({ ...prev, text: prev.text + chunk })),
      );
      const { answer, verdict } = task.accept.length > 0
        ? verifyAnswer(text, task.accept)
        : { answer: null, verdict: null };
      patch(temperatureIndex, sampleIndex, (prev) => ({
        ...prev,
        status: "done",
        ms: performance.now() - started,
        answer,
        verdict,
      }));
      return text;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        patch(temperatureIndex, sampleIndex, (prev) => ({ ...prev, status: "done", ms: performance.now() - started }));
        return "";
      }
      patch(temperatureIndex, sampleIndex, (prev) => ({
        ...prev,
        status: "error",
        ms: performance.now() - started,
        error: err instanceof Error ? err.message : "Неизвестная ошибка.",
      }));
      return "";
    }
  }

  async function judge(task: Task, signal: AbortSignal, collected: string[][]) {
    const samples = collected.flatMap((column, t) =>
      column
        .map((text, i) => ({ id: sampleId(DAY4_TEMPERATURES[t].value, i), text }))
        .filter((s) => s.text.trim().length > 0),
    );
    if (samples.length < 2) return;
    try {
      const scores = await runJudge(task, samples, signal);
      setGrid((prev) =>
        prev.map((column, t) =>
          column.map((sample, i) => ({
            ...sample,
            score: scores[sampleId(DAY4_TEMPERATURES[t].value, i)] ?? null,
          })),
        ),
      );
      if (Object.keys(scores).length === 0) {
        setJudgeError("Судья вернул ответ, который не удалось разобрать как JSON.");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setJudgeError(err instanceof Error ? err.message : "Судья не ответил.");
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

    setGrid(idleGrid());
    setJudgeError(null);
    setRanTask(task);
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;

    const collected: string[][] = DAY4_TEMPERATURES.map(() =>
      Array.from({ length: SAMPLES_PER_TEMPERATURE }, () => ""),
    );
    await Promise.allSettled(
      DAY4_TEMPERATURES.flatMap((_, t) =>
        Array.from({ length: SAMPLES_PER_TEMPERATURE }, async (_, i) => {
          collected[t][i] = await runOne(task, t, i, controller.signal);
        }),
      ),
    );
    setRunning(false);
    abortRef.current = null;

    // Судья идёт последним запросом: ему нужны все ответы разом.
    await judge(task, controller.signal, collected);
  }

  const stats: (DiversityStats | null)[] = grid.map((column) => {
    const texts = column.filter((s) => s.status === "done").map((s) => s.text);
    return texts.length > 0 ? diversityStats(texts) : null;
  });

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap gap-2">
          {DAY4_TASKS.map((task) => (
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
                  {preset.expected
                    ? <>Эталонный ответ: <span className="font-mono text-foreground">{preset.expected}</span></>
                    : "У задачи нет одного верного ответа — сравниваем разнообразие и креативность."}
                </p>
              </>
            ) : (
              <div className="flex flex-col gap-2">
                <textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  rows={3}
                  placeholder="Запрос, который уйдёт при всех трёх температурах"
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
              Запустить {TOTAL_SAMPLES} ответов
            </button>
          )}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {DAY4_TEMPERATURES.map((setting, index) => (
          <TemperatureColumn
            key={setting.value}
            setting={setting}
            samples={grid[index]}
            stats={stats[index]}
            hasReference={(ranTask?.accept.length ?? 0) > 0}
          />
        ))}
      </div>

      {judgeError && <p className="text-sm text-amber-300">Оценка судьи недоступна: {judgeError}</p>}

      {finished && (
        <TemperatureSummary
          samplesByTemperature={grid}
          stats={stats}
          hasReference={(ranTask?.accept.length ?? 0) > 0}
        />
      )}
    </div>
  );
}

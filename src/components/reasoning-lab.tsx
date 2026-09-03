"use client";

import { useRef, useState } from "react";
import { PaperPlaneRight, Stop } from "@phosphor-icons/react";
import {
  DAY3_STRATEGIES,
  DAY3_TASKS,
  verifyAnswer,
  type StrategyId,
  type Task,
} from "@/lib/day3";
import { runStrategy } from "@/lib/day3-runner";
import { IDLE_PANE, ReasoningPane, type PaneState } from "./reasoning-pane";
import { ReasoningSummary } from "./reasoning-summary";

const CUSTOM_TASK_ID = "custom";

type Panes = Record<StrategyId, PaneState>;

function idlePanes(): Panes {
  return Object.fromEntries(DAY3_STRATEGIES.map((s) => [s.id, IDLE_PANE])) as Panes;
}

export function ReasoningLab() {
  const [taskId, setTaskId] = useState<string>(DAY3_TASKS[0].id);
  const [customPrompt, setCustomPrompt] = useState("");
  const [customExpected, setCustomExpected] = useState("");
  const [running, setRunning] = useState(false);
  const [panes, setPanes] = useState<Panes>(idlePanes);
  const [expectedShown, setExpectedShown] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const preset = DAY3_TASKS.find((t) => t.id === taskId) ?? null;
  const customReady = customPrompt.trim().length > 0 && customExpected.trim().length > 0;
  const canRun = !running && (preset !== null || customReady);
  const finished =
    expectedShown !== null &&
    DAY3_STRATEGIES.every((s) => panes[s.id].status === "done" || panes[s.id].status === "error");

  function update(id: StrategyId, patch: (prev: PaneState) => PaneState) {
    setPanes((prev) => ({ ...prev, [id]: patch(prev[id]) }));
  }

  async function runOne(id: StrategyId, task: Task, signal: AbortSignal) {
    const started = performance.now();
    update(id, (prev) => ({ ...prev, ...IDLE_PANE, status: "running" }));
    try {
      const finalText = await runStrategy(id, task, signal, {
        initPhases: (specs) =>
          update(id, (prev) => ({
            ...prev,
            phases: specs.map((spec) => ({ ...spec, text: "" })),
          })),
        appendPhase: (index, chunk) =>
          update(id, (prev) => ({
            ...prev,
            chars: prev.chars + chunk.length,
            phases: prev.phases.map((phase, i) =>
              i === index ? { ...phase, text: phase.text + chunk } : phase,
            ),
          })),
      });
      const { answer, verdict } = verifyAnswer(finalText, task.accept);
      update(id, (prev) => ({
        ...prev,
        status: "done",
        ms: performance.now() - started,
        answer,
        verdict,
      }));
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        update(id, (prev) => ({ ...prev, status: "done", ms: performance.now() - started }));
        return;
      }
      update(id, (prev) => ({
        ...prev,
        status: "error",
        ms: performance.now() - started,
        error: err instanceof Error ? err.message : "Неизвестная ошибка.",
      }));
    }
  }

  async function run() {
    if (!canRun) return;
    const task: Task = preset
      ? { prompt: preset.prompt, accept: preset.accept }
      : { prompt: customPrompt.trim(), accept: [customExpected.trim()] };

    setPanes(idlePanes());
    setExpectedShown(preset ? preset.expected : customExpected.trim());
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    await Promise.allSettled(
      DAY3_STRATEGIES.map((strategy) => runOne(strategy.id, task, controller.signal)),
    );
    setRunning(false);
    abortRef.current = null;
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap gap-2">
          {DAY3_TASKS.map((task) => (
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
            <span className="block font-semibold">Своя задача</span>
            <span className="block text-[11px] text-muted">условие + эталон</span>
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex-1">
            {preset ? (
              <>
                <p className="text-sm leading-relaxed">{preset.prompt}</p>
                <p className="mt-2 text-xs text-muted">
                  Эталонный ответ: <span className="font-mono text-foreground">{preset.expected}</span>
                </p>
              </>
            ) : (
              <div className="flex flex-col gap-2">
                <textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  rows={3}
                  placeholder="Условие задачи с одним проверяемым ответом"
                  aria-label="Условие своей задачи"
                  className="w-full resize-y rounded-xl border border-line bg-background px-3 py-2 text-sm leading-relaxed placeholder:text-muted/70 focus:border-accent/50 focus:outline-none"
                />
                <input
                  value={customExpected}
                  onChange={(e) => setCustomExpected(e.target.value)}
                  placeholder="Эталонный ответ, с которым сверяем (например: 148)"
                  aria-label="Эталонный ответ своей задачи"
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
              Запустить 4 способа
            </button>
          )}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
        {DAY3_STRATEGIES.map((strategy) => (
          <ReasoningPane key={strategy.id} meta={strategy} state={panes[strategy.id]} />
        ))}
      </div>

      {finished && <ReasoningSummary panes={panes} expected={expectedShown} />}
    </div>
  );
}

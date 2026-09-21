"use client";

import { useState } from "react";
import {
  CheckCircleIcon,
  CircleIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";

import {
  allowedTransitions,
  TASK_PIPELINE,
  TASK_STAGE_LABELS,
  type TaskStage,
} from "@/lib/task-machine";
import type { TaskSnapshot, TaskStepStatus } from "@/lib/task-types";

const STEP_ICONS: Record<TaskStepStatus, string> = {
  pending: "text-muted",
  active: "text-accent",
  done: "text-emerald-300",
  skipped: "text-muted line-through",
};

const STEP_LABELS: Record<TaskStepStatus, string> = {
  pending: "ждёт",
  active: "текущий",
  done: "готов",
  skipped: "пропущен",
};

export type TaskStatePanelProps = {
  task: TaskSnapshot | null;
  enabled: boolean;
  busy: boolean;
  error: string | null;
  taskTokens: number | null;
  onToggle: (enabled: boolean) => void;
  onCreate: (title: string, goal: string) => Promise<void>;
  onTransition: (stage: TaskStage, reason: string) => Promise<void>;
  onPause: (paused: boolean) => Promise<void>;
  onAddStep: (title: string) => Promise<void>;
  onUpdateStep: (stepId: number, status: TaskStepStatus) => Promise<void>;
  onDeleteStep: (stepId: number) => Promise<void>;
};

export function TaskStatePanel({
  task,
  enabled,
  busy,
  error,
  taskTokens,
  onToggle,
  onCreate,
  onTransition,
  onPause,
  onAddStep,
  onUpdateStep,
  onDeleteStep,
}: TaskStatePanelProps) {
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [step, setStep] = useState("");
  const [blockReason, setBlockReason] = useState("");

  async function submitTask() {
    if (title.trim().length === 0) return;
    await onCreate(title.trim(), goal.trim());
    setTitle("");
    setGoal("");
  }

  async function submitStep() {
    if (step.trim().length === 0) return;
    await onAddStep(step.trim());
    setStep("");
  }

  async function submitTransition(stage: TaskStage) {
    const reason = stage === "blocked" ? blockReason.trim() : "";
    await onTransition(stage, reason);
    if (stage === "blocked") setBlockReason("");
  }

  return (
    <section className="flex flex-col gap-3 border-b border-line px-4 py-4">
      <header className="flex items-start justify-between gap-3 pr-12 xl:pr-0">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
            Task state machine
          </p>
          <h2 className="mt-1 text-base font-semibold tracking-tight">Состояние задачи</h2>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Слой задачи в промпте"
          onClick={() => onToggle(!enabled)}
          className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
            enabled
              ? "border-accent/40 bg-accent/10 text-foreground"
              : "border-line text-muted hover:text-foreground"
          }`}
        >
          <span
            aria-hidden
            className={`h-2 w-2 rounded-full ${enabled ? "bg-amber-300" : "bg-white/20"}`}
          />
          TASK {taskTokens === null ? "" : `${taskTokens} ток.`}
        </button>
      </header>

      {error && (
        <p
          className="rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs leading-relaxed text-red-200"
          role="alert"
        >
          {error}
        </p>
      )}

      {!task ? (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] leading-relaxed text-muted">
            Активной задачи нет. Заведите её — агент составит план на этапе планирования.
          </p>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Название задачи"
            aria-label="Название задачи"
            className="min-h-11 rounded-lg border border-line bg-background px-2 text-[11px] placeholder:text-muted/70 focus:border-accent/50 focus:outline-none"
          />
          <input
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="Цель (необязательно)"
            aria-label="Цель задачи"
            className="min-h-11 rounded-lg border border-line bg-background px-2 text-[11px] placeholder:text-muted/70 focus:border-accent/50 focus:outline-none"
          />
          <button
            type="button"
            disabled={busy || title.trim().length === 0}
            onClick={() => void submitTask()}
            className="min-h-11 cursor-pointer rounded-lg bg-accent-deep px-3 text-[11px] font-semibold text-white transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
          >
            Создать задачу
          </button>
        </div>
      ) : (
        <>
          <div>
            <p className="text-xs font-medium">{task.run.title}</p>
            {task.run.goal && (
              <p className="mt-0.5 text-[11px] text-muted">{task.run.goal}</p>
            )}
          </div>

          <ol className="flex flex-wrap items-center gap-1 text-[10px]">
            {TASK_PIPELINE.map((stage) => {
              const reached =
                TASK_PIPELINE.indexOf(stage) <= TASK_PIPELINE.indexOf(task.run.stage);
              const current = stage === task.run.stage;
              return (
                <li
                  key={stage}
                  className={`rounded-full border px-2 py-1 font-mono ${
                    current
                      ? "border-accent bg-accent/15 text-foreground"
                      : reached
                        ? "border-emerald-400/40 text-emerald-200"
                        : "border-line text-muted"
                  }`}
                >
                  {TASK_STAGE_LABELS[stage]}
                </li>
              );
            })}
            {(task.run.stage === "blocked" || task.run.stage === "cancelled") && (
              <li className="rounded-full border border-amber-400/50 bg-amber-400/10 px-2 py-1 font-mono text-amber-200">
                {TASK_STAGE_LABELS[task.run.stage]}
              </li>
            )}
            {task.run.paused && (
              <li className="rounded-full border border-amber-400/50 bg-amber-400/10 px-2 py-1 font-mono text-amber-200">
                пауза
              </li>
            )}
          </ol>

          <p className="rounded-lg border border-line bg-background/60 px-2 py-2 text-[11px] leading-relaxed">
            Ожидается: {task.run.expectedActor === "agent" ? "агент" : "пользователь"} —{" "}
            {task.run.expectedAction}
            {task.run.blockedReason && (
              <span className="mt-1 block text-amber-200">
                Блокировка: {task.run.blockedReason}
              </span>
            )}
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onPause(!task.run.paused)}
              className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-line px-3 text-[11px] transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
            >
              {task.run.paused ? (
                <PlayIcon size={15} weight="fill" aria-hidden />
              ) : (
                <PauseIcon size={15} weight="fill" aria-hidden />
              )}
              {task.run.paused ? "Продолжить" : "Пауза"}
            </button>
            {allowedTransitions(task.run.stage).map((stage) => (
              <button
                key={stage}
                type="button"
                disabled={busy || (stage === "blocked" && blockReason.trim().length === 0)}
                onClick={() => void submitTransition(stage)}
                className="min-h-11 cursor-pointer rounded-lg border border-line px-3 text-[11px] transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
              >
                → {TASK_STAGE_LABELS[stage]}
              </button>
            ))}
          </div>

          {allowedTransitions(task.run.stage).includes("blocked") && (
            <input
              value={blockReason}
              onChange={(event) => setBlockReason(event.target.value)}
              placeholder="Причина блокировки"
              aria-label="Причина блокировки"
              className="min-h-11 rounded-lg border border-line bg-background px-2 text-[11px] placeholder:text-muted/70 focus:border-accent/50 focus:outline-none"
            />
          )}

          <div>
            <p className="text-[11px] font-medium">Шаги</p>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {task.steps.length === 0 && (
                <li className="rounded-lg border border-dashed border-line px-2 py-2 text-center text-[11px] text-muted">
                  Плана ещё нет
                </li>
              )}
              {task.steps.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start gap-2 rounded-lg border border-line px-2 py-1.5"
                >
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Отметить шаг ${item.position} выполненным`}
                    onClick={() =>
                      void onUpdateStep(item.id, item.status === "done" ? "pending" : "done")
                    }
                    className={`flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg ${STEP_ICONS[item.status]} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40`}
                  >
                    {item.status === "done" ? (
                      <CheckCircleIcon size={17} weight="fill" aria-hidden />
                    ) : (
                      <CircleIcon size={17} aria-hidden />
                    )}
                  </button>
                  <span className="min-w-0 flex-1 break-words text-[11px] leading-relaxed">
                    <span className="font-mono text-muted">{item.position}.</span>{" "}
                    {item.title}
                    <span className="mt-0.5 block font-mono text-[9px] text-muted">
                      {STEP_LABELS[item.status]}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Удалить шаг ${item.position}`}
                    onClick={() => void onDeleteStep(item.id)}
                    className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:text-red-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
                  >
                    <TrashIcon size={14} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                value={step}
                onChange={(event) => setStep(event.target.value)}
                placeholder="Новый шаг"
                aria-label="Новый шаг"
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-background px-2 text-[11px] placeholder:text-muted/70 focus:border-accent/50 focus:outline-none"
              />
              <button
                type="button"
                aria-label="Добавить шаг"
                disabled={busy || step.trim().length === 0}
                onClick={() => void submitStep()}
                className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border border-line text-accent transition-colors hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
              >
                <PlusIcon size={15} weight="bold" aria-hidden />
              </button>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-medium">Журнал автомата</p>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {task.events.length === 0 && (
                <li className="rounded-lg border border-dashed border-line px-2 py-2 text-center text-[11px] text-muted">
                  Событий пока нет
                </li>
              )}
              {task.events.map((event) => (
                <li key={event.id} className="rounded-lg border border-line px-2 py-1.5">
                  <p
                    className={`font-mono text-[10px] ${
                      event.kind === "rejected" ? "text-red-300" : "text-muted"
                    }`}
                  >
                    {event.kind} · {event.origin === "agent" ? "агент" : "человек"}
                    {event.fromStage && event.toStage
                      ? ` · ${TASK_STAGE_LABELS[event.fromStage]} → ${TASK_STAGE_LABELS[event.toStage]}`
                      : ""}
                  </p>
                  {event.reason && (
                    <p className="mt-0.5 break-words text-[11px] leading-relaxed">
                      {event.reason}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}

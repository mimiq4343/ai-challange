"use client";

import { useState } from "react";
import {
  BrainIcon,
  ClockCounterClockwiseIcon,
  PlusIcon,
  StackSimpleIcon,
  TrashIcon,
} from "@phosphor-icons/react";

import type {
  ConversationMemorySnapshot,
  LongTermKind,
  MemoryLayerToggles,
  WorkingSlotKind,
} from "@/lib/memory-types";

const LONG_TERM_LABELS: Record<LongTermKind, string> = {
  profile: "профиль",
  decision: "решение",
  knowledge: "знание",
};

const SLOT_LABELS: Record<WorkingSlotKind, string> = {
  fact: "факт",
  constraint: "ограничение",
  step: "шаг",
  open_question: "вопрос",
};

export type MemoryInspectorProps = {
  snapshot: ConversationMemorySnapshot | null;
  layers: MemoryLayerToggles;
  busy: boolean;
  error: string | null;
  onToggleLayer: (layer: keyof MemoryLayerToggles, enabled: boolean) => void;
  onCreateLongTerm: (input: {
    kind: LongTermKind;
    key: string;
    value: string;
  }) => Promise<void>;
  onDeleteLongTerm: (id: number) => Promise<void>;
  onSaveTask: (input: { title: string; goal: string }) => Promise<void>;
  onCloseTask: () => Promise<void>;
  onAddSlot: (input: { kind: WorkingSlotKind; value: string }) => Promise<void>;
  onDeleteSlot: (id: number) => Promise<void>;
};

function LayerToggle({
  label,
  enabled,
  onChange,
}: {
  label: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        enabled
          ? "border-accent/40 bg-accent/10 text-foreground"
          : "border-line text-muted hover:text-foreground"
      }`}
    >
      <span
        aria-hidden
        className={`h-2 w-2 rounded-full ${enabled ? "bg-accent" : "bg-white/20"}`}
      />
      {label}
    </button>
  );
}

export function MemoryInspector({
  snapshot,
  layers,
  busy,
  error,
  onToggleLayer,
  onCreateLongTerm,
  onDeleteLongTerm,
  onSaveTask,
  onCloseTask,
  onAddSlot,
  onDeleteSlot,
}: MemoryInspectorProps) {
  const [longTermKind, setLongTermKind] = useState<LongTermKind>("profile");
  const [longTermKey, setLongTermKey] = useState("");
  const [longTermValue, setLongTermValue] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskGoal, setTaskGoal] = useState("");
  const [slotKind, setSlotKind] = useState<WorkingSlotKind>("constraint");
  const [slotValue, setSlotValue] = useState("");

  const task = snapshot?.working?.task ?? null;
  const slots = snapshot?.working?.slots ?? [];
  const longTerm = snapshot?.longTerm ?? [];
  const usage = snapshot?.latestUsage ?? null;

  async function submitLongTerm() {
    if (!longTermKey.trim() || !longTermValue.trim()) return;
    await onCreateLongTerm({
      kind: longTermKind,
      key: longTermKey.trim(),
      value: longTermValue.trim(),
    });
    setLongTermKey("");
    setLongTermValue("");
  }

  async function submitTask() {
    if (!taskTitle.trim()) return;
    await onSaveTask({ title: taskTitle.trim(), goal: taskGoal.trim() });
    setTaskTitle("");
    setTaskGoal("");
  }

  async function submitSlot() {
    if (!slotValue.trim()) return;
    await onAddSlot({ kind: slotKind, value: slotValue.trim() });
    setSlotValue("");
  }

  return (
    <div className="flex min-h-0 flex-col gap-4 px-4 py-4">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
          Memory layers
        </p>
        <h2 className="mt-1 text-base font-semibold tracking-tight">Модель памяти</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          Слои хранятся раздельно. Выключенный слой не попадает в промпт.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <LayerToggle
            label="STM · диалог"
            enabled={layers.shortTerm}
            onChange={(enabled) => onToggleLayer("shortTerm", enabled)}
          />
          <LayerToggle
            label="WM · задача"
            enabled={layers.working}
            onChange={(enabled) => onToggleLayer("working", enabled)}
          />
          <LayerToggle
            label="LTM · профиль"
            enabled={layers.longTerm}
            onChange={(enabled) => onToggleLayer("longTerm", enabled)}
          />
        </div>
      </header>

      {error && (
        <p
          className="rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs leading-relaxed text-red-200"
          role="alert"
        >
          {error}
        </p>
      )}

      <section className="rounded-xl border border-line bg-background/60 p-3">
        <div className="flex items-center gap-2">
          <ClockCounterClockwiseIcon className="text-accent" size={16} aria-hidden />
          <h3 className="text-sm font-semibold">Краткосрочная</h3>
          <span className="ml-auto font-mono text-[10px] text-muted">
            {snapshot
              ? `${snapshot.shortTerm.includedMessages}/${snapshot.shortTerm.totalMessages}`
              : "0/0"}
          </span>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          Дословное окно последних {snapshot?.shortTerm.windowMessages ?? 8} сообщений.
          Всё, что вышло из окна, живёт дальше только в рабочей или долговременной
          памяти.
        </p>
        {usage && (
          <p className="mt-2 font-mono text-[10px] text-muted">
            последний обмен: {usage.shortTermTokens} ток.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-line bg-background/60 p-3">
        <div className="flex items-center gap-2">
          <StackSimpleIcon className="text-accent" size={16} aria-hidden />
          <h3 className="text-sm font-semibold">Рабочая</h3>
          <span className="ml-auto font-mono text-[10px] text-muted">
            {slots.length} слот(ов)
          </span>
        </div>

        {task ? (
          <div className="mt-2">
            <p className="text-xs font-medium">{task.title}</p>
            {task.goal && <p className="mt-0.5 text-[11px] text-muted">{task.goal}</p>}
            <ul className="mt-2 flex flex-col gap-1.5">
              {slots.map((slot) => (
                <li
                  key={slot.id}
                  className="flex items-start gap-2 rounded-lg border border-line px-2 py-1.5"
                >
                  <span className="mt-0.5 rounded-full bg-amber-400/15 px-1.5 py-0.5 font-mono text-[9px] text-amber-200">
                    {SLOT_LABELS[slot.kind]}
                  </span>
                  <span className="min-w-0 flex-1 break-words text-[11px] leading-relaxed">
                    {slot.value}
                  </span>
                  <button
                    type="button"
                    aria-label={`Удалить слот ${slot.value}`}
                    disabled={busy}
                    onClick={() => void onDeleteSlot(slot.id)}
                    className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:text-red-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
                  >
                    <TrashIcon size={14} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                value={slotKind}
                aria-label="Тип слота"
                onChange={(event) => setSlotKind(event.target.value as WorkingSlotKind)}
                className="min-h-11 cursor-pointer rounded-lg border border-line bg-background px-2 text-[11px]"
              >
                {Object.entries(SLOT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                value={slotValue}
                onChange={(event) => setSlotValue(event.target.value)}
                placeholder="Новый слот задачи"
                aria-label="Значение слота"
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-background px-2 text-[11px] placeholder:text-muted/70 focus:border-accent/50 focus:outline-none"
              />
              <button
                type="button"
                disabled={busy || slotValue.trim().length === 0}
                onClick={() => void submitSlot()}
                aria-label="Добавить слот"
                className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border border-line text-accent transition-colors hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
              >
                <PlusIcon size={15} weight="bold" aria-hidden />
              </button>
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => void onCloseTask()}
              className="mt-2 min-h-11 w-full cursor-pointer rounded-lg border border-line px-3 text-[11px] text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
            >
              Закрыть задачу и очистить рабочую память
            </button>
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            <p className="text-[11px] leading-relaxed text-muted">
              Активной задачи нет. Роутер заведёт её сам, когда в диалоге появится цель,
              либо задайте её вручную.
            </p>
            <input
              value={taskTitle}
              onChange={(event) => setTaskTitle(event.target.value)}
              placeholder="Название задачи"
              aria-label="Название задачи"
              className="min-h-11 rounded-lg border border-line bg-background px-2 text-[11px] placeholder:text-muted/70 focus:border-accent/50 focus:outline-none"
            />
            <input
              value={taskGoal}
              onChange={(event) => setTaskGoal(event.target.value)}
              placeholder="Цель (необязательно)"
              aria-label="Цель задачи"
              className="min-h-11 rounded-lg border border-line bg-background px-2 text-[11px] placeholder:text-muted/70 focus:border-accent/50 focus:outline-none"
            />
            <button
              type="button"
              disabled={busy || taskTitle.trim().length === 0}
              onClick={() => void submitTask()}
              className="min-h-11 cursor-pointer rounded-lg bg-accent-deep px-3 text-[11px] font-semibold text-white transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
            >
              Создать задачу
            </button>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-line bg-background/60 p-3">
        <div className="flex items-center gap-2">
          <BrainIcon className="text-accent" size={16} aria-hidden />
          <h3 className="text-sm font-semibold">Долговременная</h3>
          <span className="ml-auto font-mono text-[10px] text-muted">
            {longTerm.length} запис(ей)
          </span>
        </div>
        <p className="mt-1 text-[11px] text-muted">
          Общая для всех диалогов: удаление диалога её не стирает.
        </p>

        <ul className="mt-2 flex flex-col gap-1.5">
          {longTerm.length === 0 && (
            <li className="rounded-lg border border-dashed border-line px-2 py-3 text-center text-[11px] text-muted">
              Пока пусто. Скажите агенту, что запомнить.
            </li>
          )}
          {longTerm.map((entry) => (
            <li
              key={entry.id}
              className="flex items-start gap-2 rounded-lg border border-line px-2 py-1.5"
            >
              <span className="mt-0.5 rounded-full bg-emerald-400/15 px-1.5 py-0.5 font-mono text-[9px] text-emerald-200">
                {LONG_TERM_LABELS[entry.kind]}
              </span>
              <span className="min-w-0 flex-1 break-words text-[11px] leading-relaxed">
                <span className="font-mono text-muted">{entry.key}:</span> {entry.value}
                {entry.reason && (
                  <span className="mt-0.5 block text-[10px] text-muted">
                    {entry.origin === "user" ? "вручную" : "роутер"} · {entry.reason}
                  </span>
                )}
              </span>
              <button
                type="button"
                aria-label={`Удалить запись ${entry.key}`}
                disabled={busy}
                onClick={() => void onDeleteLongTerm(entry.id)}
                className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:text-red-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
              >
                <TrashIcon size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={longTermKind}
            aria-label="Тип записи"
            onChange={(event) => setLongTermKind(event.target.value as LongTermKind)}
            className="min-h-11 cursor-pointer rounded-lg border border-line bg-background px-2 text-[11px]"
          >
            {Object.entries(LONG_TERM_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input
            value={longTermKey}
            onChange={(event) => setLongTermKey(event.target.value)}
            placeholder="ключ"
            aria-label="Ключ записи"
            className="min-h-11 w-28 rounded-lg border border-line bg-background px-2 font-mono text-[11px] placeholder:text-muted/70 focus:border-accent/50 focus:outline-none"
          />
          <input
            value={longTermValue}
            onChange={(event) => setLongTermValue(event.target.value)}
            placeholder="значение"
            aria-label="Значение записи"
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-background px-2 text-[11px] placeholder:text-muted/70 focus:border-accent/50 focus:outline-none"
          />
          <button
            type="button"
            disabled={busy || !longTermKey.trim() || !longTermValue.trim()}
            onClick={() => void submitLongTerm()}
            aria-label="Добавить запись долговременной памяти"
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border border-line text-accent transition-colors hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
          >
            <PlusIcon size={15} weight="bold" aria-hidden />
          </button>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold">Журнал записей</h3>
        <ul className="mt-2 flex flex-col gap-1.5">
          {(snapshot?.writes.length ?? 0) === 0 ? (
            <li className="rounded-lg border border-dashed border-line px-2 py-3 text-center text-[11px] text-muted">
              Роутер ещё ничего не записал в этом диалоге.
            </li>
          ) : (
            snapshot?.writes.map((write) => (
              <li key={write.id} className="rounded-lg border border-line px-2 py-1.5">
                <p className="font-mono text-[10px] text-muted">
                  {write.layer === "long_term" ? "LTM" : "WM"} · {write.kind}
                  {write.key ? ` · ${write.key}` : ""} ·{" "}
                  {write.origin === "user" ? "вручную" : "роутер"}
                </p>
                <p className="mt-0.5 break-words text-[11px] leading-relaxed">
                  {write.value}
                </p>
                {write.reason && (
                  <p className="mt-0.5 text-[10px] text-muted">{write.reason}</p>
                )}
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}

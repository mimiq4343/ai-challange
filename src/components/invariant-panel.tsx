"use client";

import { useState } from "react";
import {
  ArrowCounterClockwiseIcon,
  PencilSimpleIcon,
  PlusIcon,
  ProhibitIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";

import {
  INVARIANT_CATEGORY_LABELS,
  type Invariant,
  type InvariantCategory,
  type InvariantInput,
  type InvariantSnapshot,
} from "@/lib/invariant-types";

const EVENT_LABELS: Record<string, string> = {
  created: "создан",
  updated: "изменён",
  retired: "снят",
  restored: "возвращён",
  proposal_accepted: "предложение принято",
  proposal_rejected: "предложение отклонено",
  violation_blocked: "запрос заблокирован",
};

export type InvariantPanelProps = {
  snapshot: InvariantSnapshot | null;
  enabled: boolean;
  busy: boolean;
  error: string | null;
  invariantTokens: number | null;
  onToggle: (enabled: boolean) => void;
  onCreate: (input: InvariantInput) => Promise<void>;
  onUpdate: (id: number, input: InvariantInput) => Promise<void>;
  onRetire: (id: number) => Promise<void>;
  onRestore: (id: number) => Promise<void>;
  onAcceptProposal: (id: number) => Promise<void>;
  onRejectProposal: (id: number) => Promise<void>;
};

export function InvariantPanel({
  snapshot,
  enabled,
  busy,
  error,
  invariantTokens,
  onToggle,
  onCreate,
  onUpdate,
  onRetire,
  onRestore,
  onAcceptProposal,
  onRejectProposal,
}: InvariantPanelProps) {
  const [category, setCategory] = useState<InvariantCategory>("stack");
  const [statement, setStatement] = useState("");
  const [rationale, setRationale] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");

  const invariants = snapshot?.invariants ?? [];
  const active = invariants.filter((invariant) => invariant.status === "active");
  const retired = invariants.filter((invariant) => invariant.status === "retired");
  const proposals = snapshot?.proposals ?? [];

  async function submit() {
    if (statement.trim().length === 0) return;
    await onCreate({
      category,
      statement: statement.trim(),
      rationale: rationale.trim().length > 0 ? rationale.trim() : null,
    });
    setStatement("");
    setRationale("");
  }

  async function submitEdit(invariant: Invariant) {
    const next = editingText.trim();
    setEditingId(null);
    if (next.length === 0 || next === invariant.statement) return;
    await onUpdate(invariant.id, {
      category: invariant.category,
      statement: next,
      rationale: invariant.rationale,
    });
  }

  return (
    <section className="flex flex-col gap-3 border-b border-line px-4 py-4">
      <header className="flex items-start justify-between gap-3 pr-12 xl:pr-0">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
            Invariants
          </p>
          <h2 className="mt-1 text-base font-semibold tracking-tight">Инварианты</h2>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Слой инвариантов и проверка запросов"
          onClick={() => onToggle(!enabled)}
          className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
            enabled
              ? "border-accent/40 bg-accent/10 text-foreground"
              : "border-line text-muted hover:text-foreground"
          }`}
        >
          <span
            aria-hidden
            className={`h-2 w-2 rounded-full ${enabled ? "bg-rose-400" : "bg-white/20"}`}
          />
          INV {invariantTokens === null ? "" : `${invariantTokens} ток.`}
        </button>
      </header>

      <p className="text-[11px] leading-relaxed text-muted">
        Правила проверяются до ответа: запрос, который их нарушает, не доходит до модели.
      </p>

      {error && (
        <p
          className="rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs leading-relaxed text-red-200"
          role="alert"
        >
          {error}
        </p>
      )}

      {proposals.length > 0 && (
        <ul className="flex flex-col gap-2">
          {proposals.map((proposal) => (
            <li
              key={proposal.id}
              className="rounded-lg border border-accent/40 bg-accent/10 p-2"
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
                Агент предлагает инвариант
              </p>
              <p className="mt-1 text-xs font-medium">{proposal.statement}</p>
              <p className="mt-0.5 text-[11px] text-muted">
                [{INVARIANT_CATEGORY_LABELS[proposal.category]}]
                {proposal.rationale ? ` ${proposal.rationale}` : ""}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onAcceptProposal(proposal.id)}
                  className="min-h-11 flex-1 cursor-pointer rounded-lg bg-accent-deep px-3 text-[11px] font-semibold text-white transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
                >
                  Принять
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onRejectProposal(proposal.id)}
                  className="min-h-11 cursor-pointer rounded-lg border border-line px-3 text-[11px] text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
                >
                  Отклонить
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ul className="flex flex-col gap-1.5">
        {active.length === 0 && (
          <li className="rounded-lg border border-dashed border-line px-2 py-3 text-center text-[11px] text-muted">
            Действующих правил нет
          </li>
        )}
        {active.map((invariant) => (
          <li key={invariant.id} className="rounded-lg border border-line px-2 py-1.5">
            <div className="flex items-start gap-2">
              <ShieldCheckIcon
                className="mt-1 shrink-0 text-rose-300"
                size={15}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                {editingId === invariant.id ? (
                  <input
                    value={editingText}
                    autoFocus
                    onChange={(event) => setEditingText(event.target.value)}
                    onBlur={() => void submitEdit(invariant)}
                    aria-label={`Формулировка инварианта ${invariant.id}`}
                    className="min-h-11 w-full rounded-lg border border-line bg-background px-2 text-[11px] focus:border-accent/50 focus:outline-none"
                  />
                ) : (
                  <p className="break-words text-[11px] leading-relaxed">
                    {invariant.statement}
                  </p>
                )}
                <p className="mt-0.5 font-mono text-[9px] text-muted">
                  {INVARIANT_CATEGORY_LABELS[invariant.category]}
                  {invariant.blockedCount > 0
                    ? ` · заблокировал ${invariant.blockedCount}`
                    : ""}
                  {invariant.origin === "agent" ? " · от агента" : ""}
                </p>
                {invariant.rationale && (
                  <p className="mt-0.5 text-[10px] text-muted">{invariant.rationale}</p>
                )}
              </div>
              <button
                type="button"
                disabled={busy}
                aria-label={`Изменить инвариант ${invariant.id}`}
                onClick={() => {
                  setEditingId(invariant.id);
                  setEditingText(invariant.statement);
                }}
                className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
              >
                <PencilSimpleIcon size={14} aria-hidden />
              </button>
              <button
                type="button"
                disabled={busy}
                aria-label={`Снять инвариант ${invariant.id}`}
                onClick={() => void onRetire(invariant.id)}
                className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:text-red-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
              >
                <ProhibitIcon size={14} aria-hidden />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={category}
            aria-label="Категория инварианта"
            onChange={(event) => setCategory(event.target.value as InvariantCategory)}
            className="min-h-11 cursor-pointer rounded-lg border border-line bg-background px-2 text-[11px]"
          >
            {Object.entries(INVARIANT_CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input
            value={statement}
            onChange={(event) => setStatement(event.target.value)}
            placeholder="Например: только PostgreSQL, без ORM"
            aria-label="Формулировка инварианта"
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-background px-2 text-[11px] placeholder:text-muted/70 focus:border-accent/50 focus:outline-none"
          />
          <button
            type="button"
            aria-label="Добавить инвариант"
            disabled={busy || statement.trim().length === 0}
            onClick={() => void submit()}
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border border-line text-accent transition-colors hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
          >
            <PlusIcon size={15} weight="bold" aria-hidden />
          </button>
        </div>
        <input
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
          placeholder="Почему это правило (необязательно)"
          aria-label="Обоснование инварианта"
          className="min-h-11 rounded-lg border border-line bg-background px-2 text-[11px] placeholder:text-muted/70 focus:border-accent/50 focus:outline-none"
        />
      </div>

      {retired.length > 0 && (
        <div>
          <p className="text-[11px] font-medium">Снятые</p>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {retired.map((invariant) => (
              <li
                key={invariant.id}
                className="flex items-start gap-2 rounded-lg border border-dashed border-line px-2 py-1.5"
              >
                <span className="min-w-0 flex-1 break-words text-[11px] leading-relaxed text-muted line-through">
                  {invariant.statement}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Вернуть инвариант ${invariant.id}`}
                  onClick={() => void onRestore(invariant.id)}
                  className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
                >
                  <ArrowCounterClockwiseIcon size={14} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="text-[11px] font-medium">Журнал правил</p>
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {(snapshot?.events.length ?? 0) === 0 && (
            <li className="rounded-lg border border-dashed border-line px-2 py-2 text-center text-[11px] text-muted">
              Событий пока нет
            </li>
          )}
          {snapshot?.events.map((event) => (
            <li key={event.id} className="rounded-lg border border-line px-2 py-1.5">
              <p
                className={`font-mono text-[10px] ${
                  event.kind === "violation_blocked" ? "text-rose-300" : "text-muted"
                }`}
              >
                {EVENT_LABELS[event.kind] ?? event.kind} ·{" "}
                {event.origin === "agent" ? "агент" : "человек"}
              </p>
              {event.statement && (
                <p className="mt-0.5 break-words text-[11px] leading-relaxed">
                  {event.statement}
                </p>
              )}
              {event.detail && (
                <p className="mt-0.5 text-[10px] text-muted">{event.detail}</p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

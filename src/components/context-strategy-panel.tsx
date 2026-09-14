"use client";

import type { ContextSessionDetail } from "@/lib/context-strategy-types";

const FACT_LABELS = {
  goal: "Цель",
  constraints: "Ограничения",
  preferences: "Предпочтения",
  decisions: "Решения",
  agreements: "Договорённости",
} as const;

type Props = {
  detail: ContextSessionDetail | null;
  disabled: boolean;
  onCheckpoint: () => void;
  onActivateBranch: (branchId: string) => void;
};

export function ContextStrategyPanel({
  detail,
  disabled,
  onCheckpoint,
  onActivateBranch,
}: Props) {
  if (!detail) {
    return <div className="p-5 text-sm text-muted">Контекст загружается…</div>;
  }

  const { session } = detail;
  return (
    <section className="border-b border-line p-4" aria-label="Контекст стратегии">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
        Context strategy
      </p>
      <div className="mt-1 flex items-center justify-between gap-3">
        <h2 className="font-semibold">{session.title}</h2>
        <span className="rounded-full border border-line px-2 py-1 font-mono text-[10px] text-muted">
          {detail.retainedMessageCount} msg
        </span>
      </div>

      {session.strategy === "sliding" && (
        <div className="mt-4 rounded-xl border border-line bg-background/60 p-3">
          <p className="text-xs text-muted">Физически сохранено</p>
          <p className="mt-1 font-mono text-xl font-semibold">
            {detail.messages.length} / 6
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Старые сообщения удаляются после завершённого обмена.
          </p>
        </div>
      )}

      {session.strategy === "facts" && session.facts && (
        <dl className="mt-4 space-y-2">
          {Object.entries(session.facts).map(([key, value]) => {
            const text = Array.isArray(value) ? value.join(" · ") : value;
            return (
              <div key={key} className="rounded-xl border border-line bg-background/60 p-3">
                <dt className="text-[10px] uppercase tracking-wide text-muted">
                  {FACT_LABELS[key as keyof typeof FACT_LABELS]}
                </dt>
                <dd className="mt-1 text-xs leading-relaxed">
                  {text || "—"}
                </dd>
              </div>
            );
          })}
        </dl>
      )}

      {session.strategy === "branching" && (
        <div className="mt-4 space-y-3">
          {!detail.checkpoint ? (
            <button
              type="button"
              disabled={disabled || detail.messages.length === 0}
              onClick={onCheckpoint}
              className="min-h-11 w-full rounded-xl bg-accent-deep px-4 text-sm font-medium text-white disabled:opacity-40"
            >
              Создать checkpoint и 2 ветки
            </button>
          ) : (
            <>
              <p className="rounded-xl border border-line bg-background/60 p-3 text-xs text-muted">
                Checkpoint · message {detail.checkpoint.messageId}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {detail.branches.map((branch) => (
                  <button
                    key={branch.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => onActivateBranch(branch.id)}
                    className={`min-h-11 rounded-xl border px-3 text-sm ${
                      session.activeBranchId === branch.id
                        ? "border-accent bg-accent/15 text-foreground"
                        : "border-line text-muted"
                    }`}
                  >
                    {branch.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[10px] text-muted">
        <div className="rounded-lg border border-line p-2">
          <strong className="block font-mono text-sm text-foreground">
            {detail.totals.promptTokens}
          </strong>
          prompt
        </div>
        <div className="rounded-lg border border-line p-2">
          <strong className="block font-mono text-sm text-foreground">
            {detail.totals.completionTokens}
          </strong>
          output
        </div>
        <div className="rounded-lg border border-line p-2">
          <strong className="block font-mono text-sm text-foreground">
            ${(detail.totals.costMicrosUsd / 1_000_000).toFixed(6)}
          </strong>
          cost
        </div>
      </div>
    </section>
  );
}

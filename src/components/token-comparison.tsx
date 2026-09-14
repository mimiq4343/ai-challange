"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowsOutLineHorizontalIcon,
  FlaskIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";

import type { TokenComparisonResponse } from "@/lib/conversation-types";

type TokenComparisonProps = {
  comparison: TokenComparisonResponse;
  running: boolean;
  onRunOverflow: () => Promise<void>;
};

function formatTokens(value: number | null): string {
  return value === null ? "Нет данных" : new Intl.NumberFormat("ru-RU").format(value);
}

function formatCost(value: number): string {
  return `$${(value / 1_000_000).toFixed(6)}`;
}

export function TokenComparison({
  comparison,
  running,
  onRunOverflow,
}: TokenComparisonProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (confirmOpen && !dialog.open) dialog.showModal();
    if (!confirmOpen && dialog.open) dialog.close();
  }, [confirmOpen]);

  function closeDialog() {
    setConfirmOpen(false);
    triggerRef.current?.focus();
  }

  async function confirmRun() {
    closeDialog();
    await onRunOverflow();
  }

  const overflow = comparison.latestOverflowRun;

  return (
    <section className="mt-5 border-t border-line pt-5" aria-labelledby="comparison-title">
      <div className="flex items-center gap-2">
        <ArrowsOutLineHorizontalIcon className="text-accent" size={17} aria-hidden />
        <h3 id="comparison-title" className="text-sm font-semibold">
          Масштаб контекста
        </h3>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
        {comparison.scenarios.map((scenario) => (
          <article key={scenario.id} className="rounded-xl border border-line bg-background/45 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold">{scenario.label}</p>
              <span className="font-mono text-[9px] text-muted">estimate</span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[10px]">
              <div>
                <dt className="text-muted">request</dt>
                <dd className="mt-0.5 font-mono">{formatTokens(scenario.requestTokens)}</dd>
              </div>
              <div>
                <dt className="text-muted">history</dt>
                <dd className="mt-0.5 font-mono">{formatTokens(scenario.historyTokens)}</dd>
              </div>
              <div>
                <dt className="text-muted">response</dt>
                <dd className="mt-0.5 font-mono">{formatTokens(scenario.responseTokens)}</dd>
              </div>
              <div>
                <dt className="text-muted">total</dt>
                <dd className="mt-0.5 font-mono">{formatTokens(scenario.totalTokens)}</dd>
              </div>
              <div>
                <dt className="text-muted">context</dt>
                <dd className="mt-0.5 font-mono">
                  {((scenario.contextTokens / scenario.contextLimit) * 100).toFixed(3)}%
                </dd>
              </div>
              <div>
                <dt className="text-muted">cost</dt>
                <dd className="mt-0.5 font-mono">{formatCost(scenario.costMicrosUsd)}</dd>
              </div>
            </dl>
          </article>
        ))}

        <article className="rounded-xl border border-accent/25 bg-accent/5 p-3 sm:col-span-2 xl:col-span-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold">Переполнение</p>
            <span className="font-mono text-[9px] text-accent">real request</span>
          </div>
          {overflow ? (
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[10px]">
              <div>
                <dt className="text-muted">result</dt>
                <dd className="mt-0.5 font-mono text-accent">{overflow.outcome}</dd>
              </div>
              <div>
                <dt className="text-muted">HTTP</dt>
                <dd className="mt-0.5 font-mono">{formatTokens(overflow.httpStatus)}</dd>
              </div>
              <div>
                <dt className="text-muted">local input</dt>
                <dd className="mt-0.5 font-mono">{formatTokens(overflow.localInputTokens)}</dd>
              </div>
              <div>
                <dt className="text-muted">provider</dt>
                <dd className="mt-0.5 font-mono">{formatTokens(overflow.providerInputTokens)}</dd>
              </div>
              <div>
                <dt className="text-muted">duration</dt>
                <dd className="mt-0.5 font-mono">{overflow.durationMs} ms</dd>
              </div>
              <div>
                <dt className="text-muted">cost</dt>
                <dd className="mt-0.5 font-mono">$0.00</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-xs leading-relaxed text-muted">
              Реальный запрос ещё не запускался. Результат провайдера не симулируется.
            </p>
          )}
          <button
            ref={triggerRef}
            type="button"
            disabled={running}
            onClick={() => setConfirmOpen(true)}
            className="mt-3 flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent-deep px-3 text-xs font-semibold text-white transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
          >
            <FlaskIcon size={17} weight="fill" aria-hidden />
            {running ? "Выполняется 1 запрос…" : "Запустить реальный overflow-тест"}
          </button>
        </article>
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby="overflow-dialog-title"
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
        onClose={() => setConfirmOpen(false)}
        className="m-auto w-[min(92vw,30rem)] rounded-2xl border border-line bg-surface p-0 text-foreground shadow-[0_24px_100px_rgba(0,0,0,0.7)] backdrop:bg-black/70"
      >
        <div className="p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
              <WarningCircleIcon size={22} weight="fill" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="overflow-dialog-title" className="text-base font-semibold">
                Реальный внешний запрос
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                OpenRouter получит большой текст. Input и embedding не сохраняются.
              </p>
            </div>
            <button
              type="button"
              onClick={closeDialog}
              aria-label="Закрыть подтверждение"
              className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted transition-colors hover:bg-white/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <XIcon size={18} aria-hidden />
            </button>
          </div>

          <dl className="mt-5 grid gap-3 rounded-xl border border-line bg-background/60 p-4 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-muted">Модель</dt>
              <dd className="mt-1 break-all font-mono">nvidia/nemotron-3-embed-1b:free</dd>
            </div>
            <div>
              <dt className="text-muted">Endpoint</dt>
              <dd className="mt-1 font-mono">/api/v1/embeddings</dd>
            </div>
            <div>
              <dt className="text-muted">Лимит</dt>
              <dd className="mt-1 font-mono">32 768 токенов</dd>
            </div>
            <div>
              <dt className="text-muted">Input</dt>
              <dd className="mt-1 font-mono">33 280+ токенов</dd>
            </div>
            <div>
              <dt className="text-muted">Стоимость</dt>
              <dd className="mt-1 font-mono">$0.00</dd>
            </div>
            <div>
              <dt className="text-muted">Повторы</dt>
              <dd className="mt-1 font-mono">1 запрос · без retry</dd>
            </div>
          </dl>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={closeDialog}
              className="min-h-11 cursor-pointer rounded-xl border border-line px-4 text-sm transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={() => void confirmRun()}
              className="min-h-11 cursor-pointer rounded-xl bg-accent-deep px-4 text-sm font-semibold text-white transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Запустить 1 запрос
            </button>
          </div>
        </div>
      </dialog>
    </section>
  );
}

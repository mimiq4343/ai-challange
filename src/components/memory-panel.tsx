"use client";

import { useState, type FormEvent } from "react";
import {
  BrainIcon,
  ChatCircleTextIcon,
  NotePencilIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";

import {
  MEMORY_CATEGORY_LABELS,
  type LongTermMemoryCategory,
  type MemorySnapshot,
} from "@/lib/conversation-types";

type MemoryPanelProps = {
  snapshot: MemorySnapshot | null;
  loading: boolean;
  error: string | null;
  hasActiveConversation: boolean;
  onAddLongTerm: (category: LongTermMemoryCategory, content: string) => Promise<void>;
  onDeleteLongTerm: (id: number) => Promise<void>;
  onAddWorking: (content: string) => Promise<void>;
  onDeleteWorking: (id: number) => Promise<void>;
};

const CATEGORIES: readonly LongTermMemoryCategory[] = ["profile", "decision", "knowledge"];

function formatTokens(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

const deleteButtonClass =
  "flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted transition-colors hover:bg-white/5 hover:text-red-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40";

export function MemoryPanel({
  snapshot,
  loading,
  error,
  hasActiveConversation,
  onAddLongTerm,
  onDeleteLongTerm,
  onAddWorking,
  onDeleteWorking,
}: MemoryPanelProps) {
  const [category, setCategory] = useState<LongTermMemoryCategory>("profile");
  const [longTermInput, setLongTermInput] = useState("");
  const [workingInput, setWorkingInput] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>, action: () => Promise<void>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      await action();
    } catch {
      // Текст ошибки уже показан в панели через обработчик workspace.
    } finally {
      setPending(false);
    }
  }

  const longTermTotal = snapshot?.longTerm.reduce((total, entry) => total + entry.tokens, 0) ?? 0;
  const workingTotal = snapshot?.working.reduce((total, entry) => total + entry.tokens, 0) ?? 0;

  return (
    <div className="flex min-h-0 flex-col px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
            Memory model
          </p>
          <h2 className="mt-1 text-base font-semibold tracking-tight">Слои памяти</h2>
        </div>
        {loading && (
          <span className="text-xs text-muted" role="status">
            Обновление…
          </span>
        )}
      </div>

      {error && (
        <div
          className="mt-4 rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs leading-relaxed text-red-200"
          role="alert"
        >
          {error}
        </div>
      )}

      <section className="mt-4" aria-labelledby="memory-short-term">
        <div className="flex items-center gap-2">
          <ChatCircleTextIcon className="text-accent" size={17} aria-hidden />
          <h3 id="memory-short-term" className="text-sm font-semibold">
            Краткосрочная
          </h3>
          <span className="ml-auto rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-muted">
            {snapshot ? `${snapshot.shortTerm.messageCount} сообщ.` : "—"}
          </span>
        </div>
        <div className="mt-2 rounded-xl border border-line bg-background/60 p-3">
          <p className="font-mono text-[11px] text-muted">
            ≈ {formatTokens(snapshot?.shortTerm.tokens ?? 0)} ток. текста
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            Вся история активного диалога уходит в запрос целиком. Хранится в таблице
            messages и удаляется вместе с диалогом.
          </p>
        </div>
      </section>

      <section className="mt-4" aria-labelledby="memory-working">
        <div className="flex items-center gap-2">
          <NotePencilIcon className="text-accent" size={17} aria-hidden />
          <h3 id="memory-working" className="text-sm font-semibold">
            Рабочая
          </h3>
          <span className="ml-auto rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-muted">
            {snapshot ? `${snapshot.working.length} записей · ≈ ${formatTokens(workingTotal)} ток.` : "—"}
          </span>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          Данные текущей задачи. Попадают в system prompt только этого диалога и удаляются
          вместе с ним.
        </p>

        <div className="mt-2 flex flex-col gap-2">
          {snapshot?.working.map((entry) => (
            <article
              key={entry.id}
              className="flex items-start gap-1 rounded-xl border border-line bg-background/60 p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs leading-relaxed">{entry.content}</p>
                <p className="mt-1 font-mono text-[9px] text-muted">
                  ≈ {formatTokens(entry.tokens)} ток.
                </p>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => void onDeleteWorking(entry.id)}
                aria-label={`Удалить рабочую запись «${entry.content.slice(0, 40)}»`}
                className={deleteButtonClass}
              >
                <TrashIcon size={15} aria-hidden />
              </button>
            </article>
          ))}
        </div>

        {hasActiveConversation ? (
          <form
            className="mt-2 flex items-center gap-2"
            onSubmit={(event) =>
              void submit(event, async () => {
                const content = workingInput.trim();
                if (!content) return;
                await onAddWorking(content);
                setWorkingInput("");
              })
            }
          >
            <input
              value={workingInput}
              onChange={(event) => setWorkingInput(event.target.value)}
              maxLength={500}
              placeholder="Например: цель — демо в пятницу"
              aria-label="Новая запись рабочей памяти"
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-background px-3 py-2 text-xs leading-relaxed placeholder:text-muted/70 focus:border-accent/50 focus:outline-none"
            />
            <button
              type="submit"
              disabled={pending || !workingInput.trim()}
              aria-label="Добавить в рабочую память"
              className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-accent-deep text-white transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              <PlusIcon size={16} weight="bold" aria-hidden />
            </button>
          </form>
        ) : (
          <p className="mt-2 rounded-xl border border-dashed border-line px-3 py-2 text-[11px] text-muted">
            Начните диалог, чтобы добавить рабочие заметки.
          </p>
        )}
      </section>

      <section className="mt-4" aria-labelledby="memory-long-term">
        <div className="flex items-center gap-2">
          <BrainIcon className="text-accent" size={17} aria-hidden />
          <h3 id="memory-long-term" className="text-sm font-semibold">
            Долговременная
          </h3>
          <span className="ml-auto rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-muted">
            {snapshot ? `${snapshot.longTerm.length} записей · ≈ ${formatTokens(longTermTotal)} ток.` : "—"}
          </span>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          Профиль, решения и знания. Попадают в system prompt всех диалогов и переживают
          рестарт сервера.
        </p>

        <div className="mt-2 flex flex-col gap-2">
          {snapshot?.longTerm.map((entry) => (
            <article
              key={entry.id}
              className="flex items-start gap-1 rounded-xl border border-line bg-background/60 p-3"
            >
              <div className="min-w-0 flex-1">
                <span className="rounded-full bg-accent/10 px-2 py-0.5 font-mono text-[9px] text-accent">
                  {MEMORY_CATEGORY_LABELS[entry.category]}
                </span>
                <p className="mt-1.5 text-xs leading-relaxed">{entry.content}</p>
                <p className="mt-1 font-mono text-[9px] text-muted">
                  ≈ {formatTokens(entry.tokens)} ток.
                </p>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => void onDeleteLongTerm(entry.id)}
                aria-label={`Удалить долговременную запись «${entry.content.slice(0, 40)}»`}
                className={deleteButtonClass}
              >
                <TrashIcon size={15} aria-hidden />
              </button>
            </article>
          ))}
        </div>

        <form
          className="mt-2"
          onSubmit={(event) =>
            void submit(event, async () => {
              const content = longTermInput.trim();
              if (!content) return;
              await onAddLongTerm(category, content);
              setLongTermInput("");
            })
          }
        >
          <div className="flex gap-1" role="group" aria-label="Категория записи">
            {CATEGORIES.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={category === value}
                onClick={() => setCategory(value)}
                className={`min-h-11 flex-1 cursor-pointer rounded-xl border px-2 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  category === value
                    ? "border-accent/50 bg-accent/15 text-accent"
                    : "border-line text-muted hover:text-foreground"
                }`}
              >
                {MEMORY_CATEGORY_LABELS[value]}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              value={longTermInput}
              onChange={(event) => setLongTermInput(event.target.value)}
              maxLength={500}
              placeholder="Например: меня зовут Роман"
              aria-label="Новая запись долговременной памяти"
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-background px-3 py-2 text-xs leading-relaxed placeholder:text-muted/70 focus:border-accent/50 focus:outline-none"
            />
            <button
              type="submit"
              disabled={pending || !longTermInput.trim()}
              aria-label="Добавить в долговременную память"
              className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-accent-deep text-white transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              <PlusIcon size={16} weight="bold" aria-hidden />
            </button>
          </div>
        </form>
      </section>

      <section className="mt-4 border-t border-line pt-4" aria-labelledby="memory-context">
        <h3 id="memory-context" className="text-sm font-semibold">
          Что уходит в system prompt
        </h3>
        {snapshot?.systemContext ? (
          <>
            <p className="mt-1 font-mono text-[10px] text-muted">
              ≈ {formatTokens(snapshot.memoryContextTokens)} ток. добавляется к системному
              промпту
            </p>
            <details className="mt-2 rounded-xl border border-line bg-background/60 p-3">
              <summary className="cursor-pointer text-xs text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                Показать точный текст
              </summary>
              <pre className="chat-scroll mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-foreground/80">
                {snapshot.systemContext}
              </pre>
            </details>
          </>
        ) : (
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            Рабочая и долговременная память пусты — системный промпт не меняется.
          </p>
        )}
      </section>
    </div>
  );
}

"use client";

import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckCircle, PaperPlaneRight, Prohibit, Stop, WarningCircle } from "@phosphor-icons/react";
import { DAY2_CONSTRAINTS, DAY2_SYSTEM_PROMPT } from "@/lib/day2";

type PaneStatus = "idle" | "streaming" | "done" | "error";
type Pane = { text: string; status: PaneStatus; error: string | null };

const IDLE_PANE: Pane = { text: "", status: "idle", error: null };

const EXAMPLES = [
  "Посоветуй что-нибудь вроде «Интерстеллара»",
  "Хочу детектив на вечер, что посмотреть?",
  "Напиши SQL-запрос: топ-5 клиентов по сумме заказов",
];

const CONSTRAINT_CHIPS = [
  'response_format: json_object',
  `max_tokens: ${DAY2_CONSTRAINTS.max_tokens}`,
  `stop: "${DAY2_CONSTRAINTS.stop[0]}"`,
  "thinking: disabled",
  "system prompt: тема «кино»",
];

function tryParseJson(raw: string): unknown | null {
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) text = fence[1].trim();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function streamInto(
  body: Record<string, unknown>,
  signal: AbortSignal,
  onDelta: (chunk: string) => void,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Сервер вернул ${res.status}.`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onDelta(decoder.decode(value, { stream: true }));
  }
}

export function Compare() {
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [free, setFree] = useState<Pane>(IDLE_PANE);
  const [strict, setStrict] = useState<Pane>(IDLE_PANE);
  const abortRef = useRef<AbortController | null>(null);

  async function runPane(
    setPane: React.Dispatch<React.SetStateAction<Pane>>,
    body: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    setPane({ text: "", status: "streaming", error: null });
    try {
      await streamInto(body, signal, (chunk) =>
        setPane((prev) => ({ ...prev, text: prev.text + chunk })),
      );
      setPane((prev) => ({ ...prev, status: "done" }));
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setPane((prev) => ({ ...prev, status: "done" }));
      } else {
        setPane((prev) => ({
          ...prev,
          status: "error",
          error: err instanceof Error ? err.message : "Неизвестная ошибка.",
        }));
      }
    }
  }

  async function run(text: string) {
    const content = text.trim();
    if (!content || running) return;
    setInput(content);
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const messages = [{ role: "user", content }];
    await Promise.allSettled([
      runPane(setFree, { messages }, controller.signal),
      runPane(
        setStrict,
        { messages, system: DAY2_SYSTEM_PROMPT, ...DAY2_CONSTRAINTS },
        controller.signal,
      ),
    ]);
    setRunning(false);
    abortRef.current = null;
  }

  const parsed = strict.status === "done" ? tryParseJson(strict.text) : null;
  const parsedStatus =
    parsed && typeof parsed === "object" && "status" in (parsed as Record<string, unknown>)
      ? String((parsed as Record<string, unknown>).status)
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(input);
        }}
        className="mx-auto flex w-full max-w-[900px] items-center gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Один запрос для обоих вариантов"
          aria-label="Один запрос для обоих вариантов"
          className="flex-1 rounded-xl border border-line bg-surface px-4 py-3 text-sm leading-relaxed placeholder:text-muted/70 focus:border-accent/50 focus:outline-none"
        />
        {running ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            aria-label="Остановить"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line text-foreground transition-colors hover:bg-white/5 active:scale-[0.98]"
          >
            <Stop size={18} weight="fill" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            aria-label="Сравнить"
            className="flex h-11 items-center gap-2 rounded-xl bg-accent-deep px-4 text-sm font-semibold text-white transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.98]"
          >
            <PaperPlaneRight size={16} weight="fill" />
            Сравнить
          </button>
        )}
      </form>

      {free.status === "idle" && strict.status === "idle" && (
        <div className="mx-auto flex max-w-[900px] flex-wrap justify-center gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => void run(example)}
              className="rounded-xl border border-line px-3 py-2 text-xs text-muted transition-colors hover:border-accent/40 hover:text-foreground active:scale-[0.98]"
            >
              {example}
            </button>
          ))}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        <section className="flex min-h-[320px] flex-col overflow-hidden rounded-2xl border border-line bg-surface">
          <header className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">Без ограничений</h2>
            <p className="mt-1 text-xs text-muted">
              Голый запрос: настройки по умолчанию, thinking включён.
            </p>
          </header>
          <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {free.status === "idle" && (
              <p className="text-sm text-muted">Ответ появится здесь.</p>
            )}
            {free.error && <p className="text-sm text-red-300">{free.error}</p>}
            <div className="chat-md text-sm leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{free.text}</ReactMarkdown>
            </div>
            {free.status === "streaming" && (
              <span className="ml-0.5 inline-block h-4 w-2 rounded-[2px] bg-accent motion-safe:animate-pulse" />
            )}
          </div>
        </section>

        <section className="flex min-h-[320px] flex-col overflow-hidden rounded-2xl border border-accent/25 bg-surface">
          <header className="border-b border-line px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Агент «Кино-консьерж»: строгий JSON</h2>
              {strict.status === "done" && parsed !== null && parsedStatus === "ok" && (
                <span className="flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-xs text-emerald-300">
                  <CheckCircle size={14} weight="fill" /> валидный JSON
                </span>
              )}
              {strict.status === "done" && parsed !== null && parsedStatus === "refused" && (
                <span className="flex items-center gap-1 rounded-full bg-amber-400/10 px-2 py-0.5 text-xs text-amber-300">
                  <Prohibit size={14} weight="bold" /> отказ: не по теме
                </span>
              )}
              {strict.status === "done" && parsed === null && (
                <span className="flex items-center gap-1 rounded-full bg-red-400/10 px-2 py-0.5 text-xs text-red-300">
                  <WarningCircle size={14} weight="fill" /> невалидный JSON
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {CONSTRAINT_CHIPS.map((chip) => (
                <span
                  key={chip}
                  className="rounded-md border border-accent/20 bg-accent/5 px-1.5 py-0.5 font-mono text-[10px] text-accent"
                >
                  {chip}
                </span>
              ))}
            </div>
          </header>
          <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {strict.status === "idle" && (
              <p className="text-sm text-muted">Ответ появится здесь.</p>
            )}
            {strict.error && <p className="text-sm text-red-300">{strict.error}</p>}
            {strict.status === "done" && !strict.error && strict.text.trim() === "" && (
              <p className="text-sm text-amber-300">
                Модель вернула пустой ответ (известная особенность JSON mode). Попробуйте ещё раз.
              </p>
            )}
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground/90">
              {parsed !== null ? JSON.stringify(parsed, null, 2) : strict.text}
            </pre>
            {strict.status === "streaming" && (
              <span className="ml-0.5 inline-block h-4 w-2 rounded-[2px] bg-accent motion-safe:animate-pulse" />
            )}
          </div>
          <details className="border-t border-line px-4 py-2 text-xs text-muted">
            <summary className="cursor-pointer select-none">system prompt агента</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
              {DAY2_SYSTEM_PROMPT}
            </pre>
          </details>
        </section>
      </div>
    </div>
  );
}

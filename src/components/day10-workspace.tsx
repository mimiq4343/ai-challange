"use client";

import { useEffect, useRef, useState } from "react";
import {
  GitBranchIcon,
  PaperPlaneRightIcon,
  StopIcon,
} from "@phosphor-icons/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ContextBenchmarkPanel } from "@/components/context-benchmark-panel";
import { ContextStrategyPanel } from "@/components/context-strategy-panel";
import type {
  ContextBenchmarkRun,
  ContextSession,
  ContextSessionDetail,
  ContextStrategy,
} from "@/lib/context-strategy-types";

const STRATEGIES: Array<{
  id: ContextStrategy;
  label: string;
  short: string;
}> = [
  { id: "sliding", label: "Sliding Window", short: "Последние 6" },
  { id: "facts", label: "Sticky Facts", short: "Facts + 6" },
  { id: "branching", label: "Branching", short: "2 ветки" },
];

type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type Props = {
  initialSessions: ContextSession[];
  initialRun: ContextBenchmarkRun | null;
  model: string | null;
};

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String(payload.error)
        : `Сервер вернул ${response.status}.`;
    throw new Error(message);
  }
  return payload as T;
}

function toUiMessages(detail: ContextSessionDetail): UiMessage[] {
  return detail.messages.map((message) => ({
    id: `stored-${message.id}`,
    role: message.role,
    content: message.content,
  }));
}

export function Day10Workspace({ initialSessions, initialRun, model }: Props) {
  const [strategy, setStrategy] = useState<ContextStrategy>("sliding");
  const [, setSessions] = useState(initialSessions);
  const [detail, setDetail] = useState<ContextSessionDetail | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState(initialRun);
  const [benchmarking, setBenchmarking] = useState(false);
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null);
  const sessionIdsRef = useRef<Partial<Record<ContextStrategy, string>>>(
    Object.fromEntries(initialSessions.map((session) => [session.strategy, session.id])),
  );
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const transientIdRef = useRef(0);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages]);

  useEffect(() => {
    let cancelled = false;
    async function loadStrategy() {
      setLoading(true);
      setError(null);
      setDetail(null);
      setMessages([]);
      try {
        let sessionId = sessionIdsRef.current[strategy];
        if (!sessionId) {
          const created = await requestJson<{ session: ContextSession }>(
            "/api/context-strategies/sessions",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ strategy }),
            },
          );
          sessionId = created.session.id;
          sessionIdsRef.current[strategy] = sessionId;
          setSessions((current) => [created.session, ...current]);
        }
        const result = await requestJson<{ detail: ContextSessionDetail }>(
          `/api/context-strategies/sessions/${encodeURIComponent(sessionId)}`,
        );
        if (!cancelled) {
          setDetail(result.detail);
          setMessages(toUiMessages(result.detail));
        }
      } catch (actionError) {
        if (!cancelled) {
          setError(actionError instanceof Error ? actionError.message : "Не удалось загрузить стратегию.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadStrategy();
    return () => {
      cancelled = true;
    };
  }, [strategy]);

  async function refreshDetail(sessionId: string): Promise<void> {
    const result = await requestJson<{ detail: ContextSessionDetail }>(
      `/api/context-strategies/sessions/${encodeURIComponent(sessionId)}`,
    );
    setDetail(result.detail);
    setMessages(toUiMessages(result.detail));
    setSessions((current) =>
      current.map((session) =>
        session.id === result.detail.session.id ? result.detail.session : session,
      ),
    );
  }

  async function send(): Promise<void> {
    const content = input.trim();
    if (!content || !detail || streaming || loading) return;
    const sessionId = detail.session.id;
    const exchangeId = ++transientIdRef.current;
    const assistantId = `assistant-${exchangeId}`;
    setInput("");
    setError(null);
    setStreaming(true);
    setMessages((current) => [
      ...current,
      { id: `user-${exchangeId}`, role: "user", content },
      { id: assistantId, role: "assistant", content: "" },
    ]);

    try {
      const controller = new AbortController();
      abortRef.current = controller;
      const response = await fetch(
        `/api/context-strategies/sessions/${encodeURIComponent(sessionId)}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
          signal: controller.signal,
        },
      );
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null);
        throw new Error(
          payload && typeof payload === "object" && "error" in payload
            ? String(payload.error)
            : `Сервер вернул ${response.status}.`,
        );
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const delta = decoder.decode(value, { stream: true });
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? { ...message, content: message.content + delta }
              : message,
          ),
        );
      }
      const finalDelta = decoder.decode();
      if (finalDelta) {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? { ...message, content: message.content + finalDelta }
              : message,
          ),
        );
      }
      await refreshDetail(sessionId);
    } catch (actionError) {
      if (!(actionError instanceof DOMException && actionError.name === "AbortError")) {
        setInput(content);
        setError(actionError instanceof Error ? actionError.message : "Не удалось получить ответ.");
      }
      await refreshDetail(sessionId).catch(() => undefined);
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  }

  async function createCheckpoint(): Promise<void> {
    if (!detail || streaming) return;
    setLoading(true);
    setError(null);
    try {
      const result = await requestJson<{ detail: ContextSessionDetail }>(
        `/api/context-strategies/sessions/${encodeURIComponent(detail.session.id)}/checkpoint`,
        { method: "POST" },
      );
      setDetail(result.detail);
      setMessages(toUiMessages(result.detail));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Не удалось создать checkpoint.");
    } finally {
      setLoading(false);
    }
  }

  async function activateBranch(branchId: string): Promise<void> {
    if (!detail || streaming || branchId === detail.session.activeBranchId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await requestJson<{ detail: ContextSessionDetail }>(
        `/api/context-strategies/sessions/${encodeURIComponent(detail.session.id)}/branches/${encodeURIComponent(branchId)}/activate`,
        { method: "POST" },
      );
      setDetail(result.detail);
      setMessages(toUiMessages(result.detail));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Не удалось переключить ветку.");
    } finally {
      setLoading(false);
    }
  }

  async function runBenchmark(): Promise<void> {
    if (benchmarking) return;
    setBenchmarking(true);
    setBenchmarkError(null);
    try {
      const result = await requestJson<{ run: ContextBenchmarkRun }>(
        "/api/context-strategies/benchmark",
        { method: "POST" },
      );
      setRun(result.run);
    } catch (actionError) {
      setBenchmarkError(actionError instanceof Error ? actionError.message : "Benchmark завершился ошибкой.");
    } finally {
      setBenchmarking(false);
    }
  }

  const activeBranch = detail?.branches.find(
    (branch) => branch.id === detail.session.activeBranchId,
  );
  const controlsDisabled = loading || streaming;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_24px_80px_rgba(3,5,16,0.5)]">
      <div className="flex gap-2 overflow-x-auto border-b border-line p-2" aria-label="Стратегия контекста">
        {STRATEGIES.map((item) => (
          <button
            key={item.id}
            type="button"
            disabled={controlsDisabled}
            onClick={() => setStrategy(item.id)}
            className={`min-h-11 min-w-[9.5rem] flex-1 rounded-xl border px-3 text-left transition-colors ${
              strategy === item.id
                ? "border-accent bg-accent/15 text-foreground"
                : "border-line bg-background/40 text-muted hover:text-foreground"
            }`}
          >
            <span className="block text-xs font-medium">{item.label}</span>
            <span className="mt-0.5 block font-mono text-[9px] uppercase tracking-wide">{item.short}</span>
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col" aria-label="Day 10 chat">
          <header className="flex min-h-14 flex-wrap items-center gap-2 border-b border-line px-3 sm:px-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {detail?.session.title ?? STRATEGIES.find(({ id }) => id === strategy)?.label}
              </p>
              <p className="font-mono text-[10px] text-muted">
                Flash Agent · {model ?? "модель не задана"}
              </p>
            </div>
            {detail?.session.strategy === "branching" && (
              <div className="ml-auto flex items-center gap-1">
                {!detail.checkpoint ? (
                  <button
                    type="button"
                    disabled={controlsDisabled || detail.messages.length === 0}
                    onClick={() => void createCheckpoint()}
                    className="min-h-11 rounded-xl border border-line px-3 text-xs text-muted disabled:opacity-40"
                  >
                    <GitBranchIcon className="mr-1 inline" aria-hidden /> Checkpoint
                  </button>
                ) : (
                  detail.branches.map((branch) => (
                    <button
                      key={branch.id}
                      type="button"
                      disabled={controlsDisabled}
                      onClick={() => void activateBranch(branch.id)}
                      className={`min-h-11 rounded-xl border px-3 text-xs ${
                        branch.id === activeBranch?.id
                          ? "border-accent bg-accent/15"
                          : "border-line text-muted"
                      }`}
                    >
                      {branch.name}
                    </button>
                  ))
                )}
              </div>
            )}
            {loading && <span className="ml-auto text-xs text-muted">Загрузка…</span>}
          </header>

          <div ref={scrollRef} className="chat-scroll min-h-0 flex-1 overflow-y-auto px-4 py-5">
            <div className="mx-auto flex min-h-full w-full max-w-[820px] flex-col gap-5" aria-live="polite">
              {messages.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center text-center">
                  <p className="font-medium">Начните диалог</p>
                  <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">
                    Стратегия меняет только контекст, который увидит модель.
                  </p>
                </div>
              ) : (
                messages.map((message) =>
                  message.role === "user" ? (
                    <div key={message.id} className="flex justify-end">
                      <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-accent/20 bg-accent/10 px-4 py-2.5 text-sm leading-relaxed">
                        {message.content}
                      </p>
                    </div>
                  ) : (
                    <div key={message.id} className="chat-md max-w-[92%] text-sm leading-relaxed">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                      {streaming && message.id === messages.at(-1)?.id && (
                        <span className="ml-0.5 inline-block h-4 w-2 translate-y-0.5 rounded-[2px] bg-accent motion-safe:animate-pulse" />
                      )}
                    </div>
                  ),
                )
              )}
            </div>
          </div>

          {error && (
            <div className="mx-auto mb-2 w-[calc(100%-2rem)] max-w-[820px] rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200" role="alert">
              {error}
            </div>
          )}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
            className="border-t border-line px-3 py-3"
          >
            <div className="mx-auto flex w-full max-w-[820px] items-end gap-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                placeholder="Сообщение агенту"
                aria-label="Сообщение агенту"
                className="min-h-11 flex-1 resize-none rounded-xl border border-line bg-background px-3 py-2.5 text-sm focus:border-accent/50 focus:outline-none"
              />
              {streaming ? (
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  aria-label="Остановить генерацию"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line"
                >
                  <StopIcon size={18} weight="fill" aria-hidden />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim() || controlsDisabled}
                  aria-label="Отправить"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-deep text-white disabled:opacity-40"
                >
                  <PaperPlaneRightIcon size={18} weight="fill" aria-hidden />
                </button>
              )}
            </div>
          </form>
        </section>

        <aside className="hidden w-[30rem] shrink-0 overflow-y-auto border-l border-line xl:block">
          <ContextStrategyPanel
            detail={detail}
            disabled={controlsDisabled}
            onCheckpoint={() => void createCheckpoint()}
            onActivateBranch={(branchId) => void activateBranch(branchId)}
          />
          <ContextBenchmarkPanel
            run={run}
            running={benchmarking}
            error={benchmarkError}
            onRun={() => void runBenchmark()}
          />
        </aside>
      </div>
    </div>
  );
}

"use client";

import { PaperPlaneRightIcon, StopIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { McpToolCard, type McpToolTrace } from "@/components/mcp-tool-card";
import { SupportContext, SUPPORT_STATUS } from "@/components/support-context";
import { consumeMcpChatStream } from "@/lib/mcp-chat-stream";
import type { SupportSource, SupportTicketState } from "@/lib/support-types";
import { SUPPORT_CONFIG } from "@/lib/support-config";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const BUTTON = `min-h-11 min-w-11 cursor-pointer rounded-xl border border-line px-3 py-2 text-sm transition-colors hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS}`;

function Answer({ answer, sources }: { answer: string; sources: SupportSource[] }) {
  return <article className="min-w-0 rounded-2xl rounded-bl-md border border-line bg-background p-4">
    <div className="prose prose-sm prose-invert max-w-none min-w-0 break-words [overflow-wrap:anywhere] [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_a]:inline-block [&_a]:min-h-11 [&_a]:py-2 [&_table]:block [&_table]:overflow-x-auto">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
    </div>
    {sources.length > 0 && <section className="mt-4 space-y-2 border-t border-line pt-3" aria-label="Источники ответа">
      <h3 className="text-xs font-medium text-muted">По базе знаний</h3>
      {sources.map(source => <details key={source.id} className="min-w-0 rounded-xl border border-line bg-surface">
        <summary className={`min-h-11 cursor-pointer break-words rounded-xl p-3 text-xs leading-relaxed ${FOCUS}`}>[{source.id}] {source.section}</summary>
        <div className="border-t border-line p-3"><p className="text-[11px] text-muted">{source.source} · строки {source.startLine}–{source.endLine}</p><p className="mt-2 text-xs leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{source.text}</p></div>
      </details>)}
    </section>}
  </article>;
}

async function loadTicket(ticketId: string, signal?: AbortSignal): Promise<SupportTicketState> {
  const response = await fetch(`/api/support/tickets/${encodeURIComponent(ticketId)}`, { signal, cache: "no-store" });
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : "Не удалось загрузить тикет.");
  return value;
}

export function SupportChat({ ticketId }: { ticketId: string }) {
  const [state, setState] = useState<SupportTicketState | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [traces, setTraces] = useState<McpToolTrace[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const focusAfterRequest = useRef(false);
  const requestGeneration = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    loadTicket(ticketId, controller.signal).then(value => { if (!controller.signal.aborted) setState(value); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить тикет."); });
    return () => { controller.abort(); abortRef.current?.abort(); };
  }, [ticketId]);
  useEffect(() => { if (busy || answer) bottomRef.current?.scrollIntoView({ block: "nearest" }); }, [busy, answer, traces.length]);
  useEffect(() => {
    if (!busy && focusAfterRequest.current) { focusAfterRequest.current = false; inputRef.current?.focus({ preventScroll: true }); }
  }, [busy]);

  async function refresh() {
    const generation = ++requestGeneration.current;
    try {
      const loaded = await loadTicket(ticketId);
      if (generation !== requestGeneration.current) return;
      setState(loaded); setError(null); setPendingQuestion(""); setAnswer("");
    } catch (cause) {
      if (generation === requestGeneration.current) setError(cause instanceof Error ? cause.message : "Не удалось обновить переписку.");
    }
  }

  async function send(raw: string) {
    const content = raw.trim();
    if (!state || busyRef.current || !content) return;
    busyRef.current = true;
    requestGeneration.current++;
    const controller = new AbortController(); abortRef.current = controller;
    setBusy(true); setError(null); setTraces([]); setAnswer(""); setPendingQuestion(content); setInput("");
    try {
      const response = await fetch(`/api/support/tickets/${encodeURIComponent(ticketId)}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ content, expectedCursor: state.exchanges.at(-1)?.id ?? null }),
      });
      if (!response.ok || !response.body) {
        const payload = await response.json();
        throw new Error(typeof payload.error === "string" ? payload.error : "Не удалось отправить вопрос.");
      }
      await consumeMcpChatStream(response.body, event => {
        if (event.type === "tool-start") setTraces(current => [...current, { callId: event.callId, name: event.name, arguments: event.arguments }]);
        if (event.type === "tool-result") setTraces(current => current.map(trace => trace.callId === event.callId ? { ...trace, result: event.result } : trace));
        if (event.type === "text") setAnswer(current => current + event.delta);
      });
      const saved = await loadTicket(ticketId, controller.signal);
      setState(saved); setPendingQuestion(""); setAnswer("");
    } catch (cause) {
      if (controller.signal.aborted) setError("Запрос остановлен. Обновите переписку, чтобы проверить, успел ли ответ сохраниться.");
      else setError(cause instanceof Error ? cause.message : "Не удалось получить ответ.");
      setInput(content);
    } finally { busyRef.current = false; focusAfterRequest.current = true; setBusy(false); abortRef.current = null; }
  }
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(input); }
  }

  if (!state) return <div className="min-w-0 rounded-2xl border border-line bg-surface p-5" role={error ? "alert" : "status"}>{error ?? "Загружаем обращение…"}</div>;
  return <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(16rem,22vw)]">
    <section className="flex min-w-0 flex-col rounded-2xl border border-line bg-surface" aria-label="Переписка по тикету">
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
        <span className="font-mono text-sm text-accent">{state.ticket.id}</span>
        <h2 className="order-last w-full min-w-0 font-semibold sm:order-none sm:w-auto sm:flex-1">{state.ticket.title}</h2>
        <span className="ml-auto rounded-full border border-line px-2.5 py-1 text-xs text-muted sm:ml-0">{SUPPORT_STATUS[state.ticket.status]}</span>
      </div>
      <div className="chat-scroll max-h-[65dvh] min-h-[20rem] min-w-0 space-y-4 overflow-y-auto p-3 sm:p-4">
        {state.exchanges.length === 0 && !pendingQuestion && <div className="py-8 text-center"><p className="font-semibold">Разберёмся с обращением</p><p className="mx-auto mt-2 max-w-[50ch] text-sm leading-relaxed text-muted">Ассистент прочитает тикет, учтёт предыдущие проверки и найдёт рекомендации в базе знаний.</p></div>}
        <ol className="space-y-5" aria-label="История переписки">{state.exchanges.map(exchange => <li key={exchange.id} className="min-w-0 space-y-3">
          <p className="ml-auto w-fit max-w-full rounded-2xl rounded-br-md border border-accent/30 bg-accent/10 px-3 py-2 text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{exchange.question}</p>
          <Answer answer={exchange.answer} sources={exchange.sources} />
        </li>)}</ol>
        {pendingQuestion && <div className="space-y-3"><p className="ml-auto w-fit max-w-full rounded-2xl border border-accent/30 bg-accent/10 px-3 py-2 text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{pendingQuestion}</p>{answer && <Answer answer={answer} sources={[]} />}</div>}
        {traces.length > 0 && <details className="min-w-0 rounded-xl border border-line" aria-label="Вызовы MCP-инструментов"><summary className={`min-h-11 cursor-pointer px-3 py-3 text-xs text-muted ${FOCUS}`}>Действия ассистента · {traces.length}</summary><div className="space-y-2 p-2">{traces.map(trace => <McpToolCard key={trace.callId} trace={trace} defaultOpen={false} />)}</div></details>}
        {busy && <p role="status" className="text-sm text-muted">Читаем контекст и ищем ответ…</p>}
        {error && <div role="alert" className="space-y-2"><p className="text-sm text-red-300">{error}</p><button type="button" disabled={busy} onClick={() => void refresh()} className={BUTTON}>Обновить переписку</button></div>}
        <div ref={bottomRef} />
      </div>
      <form className="border-t border-line p-3 sm:p-4" onSubmit={event => { event.preventDefault(); void send(input); }}>
        {!state.exchanges.length && <div className="mb-3 flex flex-wrap gap-2">{["Почему это происходит и что делать дальше?", "Что уже проверили по моему обращению?"].map(example => <button key={example} className={`${BUTTON} text-left text-xs`} type="button" disabled={busy} onClick={() => void send(example)}>{example}</button>)}</div>}
        <label htmlFor="support-question" className="mb-2 block text-xs text-muted">Уточните проблему</label>
        <div className="flex items-end gap-2">
          <textarea id="support-question" ref={inputRef} aria-label="Вопрос поддержке" aria-describedby="support-input-hint" rows={2} maxLength={SUPPORT_CONFIG.maxQuestionCharacters} value={input} onChange={event => setInput(event.target.value)} onKeyDown={keyDown} disabled={busy} placeholder="Например: почему не работает авторизация?" className="min-h-11 min-w-0 flex-1 resize-y rounded-xl border border-line bg-background p-3 text-sm placeholder:text-muted/70 focus:border-accent focus:outline-none disabled:opacity-60" />
          {busy ? <button type="button" aria-label="Остановить запрос" onClick={() => abortRef.current?.abort()} className={BUTTON}><StopIcon size={18} aria-hidden /></button>
            : <button type="submit" aria-label="Отправить вопрос" disabled={!input.trim()} className={`${BUTTON} bg-accent-deep text-white`}><PaperPlaneRightIcon size={18} aria-hidden /></button>}
        </div>
        <p id="support-input-hint" className="mt-2 text-[11px] leading-relaxed text-muted">Enter — отправить, Shift+Enter — новая строка. Не отправляйте пароли и ключи.</p>
      </form>
    </section>
    <SupportContext state={state} />
  </div>;
}

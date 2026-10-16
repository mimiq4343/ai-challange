"use client";

import { GitBranchIcon, PaperPlaneRightIcon, StopIcon, TerminalWindowIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { McpToolCard, type McpToolTrace } from "@/components/mcp-tool-card";
import { DEV_ASSISTANT_LIMITS } from "@/lib/dev-assistant-config";
import { answerCitations, collectDocsSources } from "@/lib/dev-assistant-sources";
import type { McpChatEvent } from "@/lib/mcp-chat-types";
import { consumeMcpChatStream } from "@/lib/mcp-chat-stream";
import { projectToolOutputSchemas, type ProjectToolOutput } from "@/lib/project-tool-schemas";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const CARD = "min-w-0 rounded-2xl border border-line bg-surface p-4 sm:p-5";
const CHIP = `min-h-11 cursor-pointer rounded-xl border border-line px-3 py-2 text-left font-mono text-xs leading-relaxed transition-colors hover:border-accent/40 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`;
const HELP_COMMAND = /^\/help(?:\s|$)/;
const EXAMPLES = [
  "/help",
  "/help Как устроен проект и где лежат API-маршруты?",
  "/help Какие таблицы SQLite хранят историю диалогов?",
  "/help Какие инструменты есть у MCP-сервера проекта?",
  "/help Что изменено в текущей ветке?",
  "/help Какие проверки запускать перед вливанием дня в main?",
];

type Branch = ProjectToolOutput<"git_branch">;
type Exchange = { id: number; command: string; traces: McpToolTrace[]; answer: string; status: "running" | "done" | "error" | "stopped"; error?: string; seconds?: number };
export type DocsIndexSummary = { files: number; chunks: number; hitRate: number; createdAt: string; stale: boolean } | null;

function branchLabel(branch: Branch): string {
  return `${branch.branch ?? "detached HEAD"}${branch.head ? ` · ${branch.head.slice(0, 7)}` : ""}`;
}

function ExchangeView({ exchange }: { exchange: Exchange }) {
  const { sources, stale } = collectDocsSources(exchange.traces);
  const { cited, unknown } = answerCitations(exchange.answer, sources);
  return (
    <li className="min-w-0 space-y-3">
      <p className="ml-auto w-fit max-w-full rounded-2xl rounded-br-md border border-accent/30 bg-accent/10 px-3 py-2 font-mono text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{exchange.command}</p>
      {exchange.traces.length > 0 && (
        <div className="space-y-2" aria-label="Вызовы MCP-инструментов">
          {exchange.traces.map((trace) => <McpToolCard key={trace.callId} trace={trace} defaultOpen={false} />)}
        </div>
      )}
      <article className="min-w-0 rounded-2xl rounded-bl-md border border-line bg-background p-4">
        {exchange.status === "running" && !exchange.answer && <p className="text-sm text-muted" role="status">Ассистент вызывает инструменты проекта и готовит ответ…</p>}
        {exchange.answer && (
          <div className="prose prose-sm prose-invert max-w-none min-w-0 break-words [overflow-wrap:anywhere] [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:overflow-x-auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{exchange.answer}</ReactMarkdown>
          </div>
        )}
        {exchange.status === "error" && <p role="alert" className="text-sm text-red-300">{exchange.error}</p>}
        {exchange.status === "stopped" && <p className="text-sm text-muted">Запрос остановлен; неполный ответ не показан.</p>}
        {exchange.seconds !== undefined && <p className="mt-3 text-xs text-muted">{exchange.traces.length} вызовов MCP · {exchange.seconds.toFixed(1)} с</p>}
        {stale && <p className="mt-3 text-xs text-amber-300">Документация изменилась после индексации: выполните <code>npm run dev-assistant:index</code>.</p>}
        {unknown.length > 0 && <p className="mt-3 text-xs text-amber-300">Ссылки без найденного фрагмента: {unknown.map((id) => `[${id}]`).join(", ")}.</p>}
        {exchange.status === "done" && sources.length > 0 && (
          <section className="mt-4 border-t border-line pt-3" aria-label="Источники из документации">
            <h3 className="text-sm font-medium">Источники</h3>
            <p className="mt-1 text-xs text-muted">Фрагменты из search_docs этого запроса. «Использован» — модель сослалась на ID; это не проверка смысла.</p>
            <div className="mt-2 space-y-2">
              {sources.map((source) => (
                <details key={source.id} className="min-w-0 rounded-xl border border-line bg-surface">
                  <summary className={`min-h-11 cursor-pointer break-words rounded-xl p-3 text-xs leading-relaxed [overflow-wrap:anywhere] ${FOCUS_RING}`}>
                    <span className="font-medium text-foreground">[{source.id}] {source.source}</span>
                    <span className="mt-1 block text-muted">{source.section} · строки {source.startLine}–{source.endLine} · сходство {source.score.toFixed(3)}{cited.includes(source.id) ? " · использован" : ""}</span>
                  </summary>
                  <pre className="border-t border-line p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{source.text}</pre>
                </details>
              ))}
            </div>
          </section>
        )}
      </article>
    </li>
  );
}

export function DevAssistantWorkspace({ model, index }: { model: string | null; index: DocsIndexSummary }) {
  const [input, setInput] = useState("/help ");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const nextId = useRef(1);
  const running = exchanges.some((exchange) => exchange.status === "running");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/dev-assistant/branch", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Ветка недоступна.");
        const parsed = projectToolOutputSchemas.git_branch.safeParse(payload);
        if (!parsed.success) throw new Error("Некорректный ответ git_branch.");
        setBranch(parsed.data);
      })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setBranchError(cause instanceof Error ? cause.message : "Ветка недоступна."); });
    return () => controller.abort();
  }, []);
  useEffect(() => () => abortRef.current?.abort(), []);

  function update(id: number, change: (exchange: Exchange) => Exchange) {
    setExchanges((current) => current.map((exchange) => exchange.id === id ? change(exchange) : exchange));
  }

  function apply(id: number, event: McpChatEvent, toolNames: Map<string, string>) {
    if (event.type === "tool-start") {
      toolNames.set(event.callId, event.name);
      update(id, (exchange) => ({ ...exchange, traces: [...exchange.traces, { callId: event.callId, name: event.name, arguments: event.arguments }] }));
    } else if (event.type === "tool-result") {
      // Свежий git_branch из ответа обновляет плашку ветки.
      const parsed = toolNames.get(event.callId) === "git_branch" && !event.result.isError
        ? projectToolOutputSchemas.git_branch.safeParse(event.result.structuredContent) : null;
      if (parsed?.success) { setBranch(parsed.data); setBranchError(null); }
      update(id, (exchange) => ({ ...exchange, traces: exchange.traces.map((item) => item.callId === event.callId ? { ...item, result: event.result } : item) }));
    } else if (event.type === "text") {
      update(id, (exchange) => ({ ...exchange, answer: exchange.answer + event.delta }));
    }
  }

  async function send(raw: string) {
    const command = raw.trim();
    if (running || !command) return;
    if (!HELP_COMMAND.test(command)) {
      setHint("Поддерживается команда /help <вопрос о проекте>.");
      return;
    }
    setHint(null);
    const id = nextId.current++;
    const started = performance.now();
    const controller = new AbortController();
    abortRef.current = controller;
    setExchanges((current) => [...current, { id, command, traces: [], answer: "", status: "running" }]);
    setInput("/help ");
    try {
      const response = await fetch("/api/dev-assistant/help", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command }), signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null);
        throw new Error(typeof payload?.error === "string" ? payload.error : `Сервер вернул HTTP ${response.status}.`);
      }
      const toolNames = new Map<string, string>();
      await consumeMcpChatStream(response.body, (event) => apply(id, event, toolNames));
      update(id, (exchange) => ({ ...exchange, status: "done", seconds: (performance.now() - started) / 1000 }));
    } catch (cause) {
      if (controller.signal.aborted) update(id, (exchange) => ({ ...exchange, answer: "", status: "stopped" }));
      else update(id, (exchange) => ({ ...exchange, answer: "", status: "error", error: cause instanceof Error ? cause.message : "Не удалось получить ответ." }));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      textareaRef.current?.focus();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send(input);
    }
  }

  return (
    <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)]">
      <section className={`${CARD} flex min-h-[60vh] flex-col`} aria-labelledby="assistant-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="assistant-heading" className="flex items-center gap-2 text-lg font-semibold"><TerminalWindowIcon size={20} className="text-accent" aria-hidden />Команда /help</h2>
          <p className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border border-line px-3 text-xs text-muted" role="status" aria-label="Текущая git-ветка по MCP">
            <GitBranchIcon size={14} className="shrink-0 text-accent" aria-hidden />
            <span className="truncate font-mono">{branch ? branchLabel(branch) : branchError ?? "ветка загружается…"}</span>
          </p>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted">Каждая команда независима: модель {model ?? "не настроена"} сама выбирает инструменты MCP-сервера проекта и отвечает со ссылками на документацию.</p>

        <ol className="mt-4 flex-1 space-y-5" aria-live="polite">
          {exchanges.length === 0 && <li className="rounded-xl border border-dashed border-line p-4 text-sm leading-relaxed text-muted">Начните с <code>/help</code> — ассистент покажет свои возможности и текущую ветку — или выберите пример справа.</li>}
          {exchanges.map((exchange) => <ExchangeView key={exchange.id} exchange={exchange} />)}
        </ol>

        <form onSubmit={(event) => { event.preventDefault(); void send(input); }} className="mt-5 border-t border-line pt-4">
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => { setInput(event.target.value); setHint(null); }}
              onKeyDown={onKeyDown}
              maxLength={DEV_ASSISTANT_LIMITS.maxQuestionCharacters + 6}
              enterKeyHint="send"
              rows={2}
              aria-label="Команда ассистенту"
              aria-describedby="assistant-input-hint"
              className="min-h-11 flex-1 resize-y rounded-xl border border-line bg-background px-3 py-2.5 font-mono text-sm leading-relaxed placeholder:text-muted/70 focus:border-accent/50 focus:outline-none"
            />
            {running ? (
              <button type="button" onClick={() => abortRef.current?.abort()} aria-label="Остановить запрос" className={`flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-line transition-colors hover:bg-white/5 ${FOCUS_RING}`}>
                <StopIcon size={18} weight="fill" aria-hidden />
              </button>
            ) : (
              <button type="submit" disabled={!input.trim()} aria-label="Отправить команду" className={`flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-accent-deep text-white transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`}>
                <PaperPlaneRightIcon size={18} weight="fill" aria-hidden />
              </button>
            )}
          </div>
          <p id="assistant-input-hint" className={`mt-2 text-xs ${hint ? "text-amber-300" : "text-muted"}`} role={hint ? "alert" : undefined}>{hint ?? "Enter — отправить, Shift+Enter — новая строка."}</p>
        </form>
      </section>

      <aside className="space-y-5" aria-label="Контекст ассистента">
        <section className={CARD} aria-labelledby="examples-heading">
          <h2 id="examples-heading" className="font-semibold">Примеры команд</h2>
          <div className="mt-3 grid gap-2">
            {EXAMPLES.map((example) => <button key={example} type="button" disabled={running} onClick={() => void send(example)} className={CHIP}>{example}</button>)}
          </div>
        </section>
        <section className={CARD} aria-labelledby="sources-heading">
          <h2 id="sources-heading" className="font-semibold">Что знает ассистент</h2>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted">
            <li><span className="font-mono text-foreground">search_docs</span> — README.md, AGENTS.md, docs/ и SQL-схемы <code>src/lib/*-schema.ts</code>.</li>
            <li><span className="font-mono text-foreground">git_branch</span>, <span className="font-mono text-foreground">git_status</span> — ветка, HEAD и изменённые файлы.</li>
            <li><span className="font-mono text-foreground">list_files</span> — каталоги по отслеживаемым файлам.</li>
            <li><span className="font-mono text-foreground">git_diff</span> — изменения относительно HEAD.</li>
          </ul>
          {index ? (
            <p className="mt-3 text-xs leading-relaxed text-muted">Индекс: {index.files} файлов, {index.chunks} структурных чанков, HitRate@5 {(index.hitRate * 100).toFixed(1)}% · {index.createdAt}.</p>
          ) : (
            <p className="mt-3 text-xs text-amber-300">Индекс документации не создан: выполните <code>npm run dev-assistant:index</code>.</p>
          )}
          {index?.stale && <p className="mt-2 text-xs text-amber-300">Документация изменилась после индексации — пересоздайте индекс.</p>}
          <p className="mt-3 text-xs leading-relaxed text-muted">MCP-сервер работает через stdio только на чтение. Фрагменты документации, список файлов и diff уходят провайдеру модели.</p>
        </section>
      </aside>
    </div>
  );
}

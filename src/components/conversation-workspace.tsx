"use client";

import { useEffect, useRef, useState } from "react";
import {
  ListIcon,
  LightningIcon,
  PaperPlaneRightIcon,
  StopIcon,
} from "@phosphor-icons/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ConversationSidebar } from "@/components/conversation-sidebar";
import type {
  ConversationDetail,
  ConversationSummary,
  MessageRole,
  TokenBreakdown,
} from "@/lib/conversation-types";

export type MessageTokenBadge = {
  requestTokens: number;
  responseTokens: number;
  source: "provider" | "estimated";
};

export type ConversationMessageRoute =
  | "messages"
  | "compressed-messages"
  | "memory-messages";

export type ConversationWorkspaceEvents = {
  onConversationChange?: (conversationId: string | null) => void;
  onUsagePreview?: (conversationId: string, breakdown: TokenBreakdown) => void;
  onResponseHeaders?: (conversationId: string, headers: Headers) => void;
  onExchangeComplete?: (conversationId: string) => void;
  onExchangeFailed?: (conversationId: string) => void;
};

type ConversationWorkspaceProps = {
  initialConversations: ConversationSummary[];
  initialDetail: ConversationDetail | null;
  model: string | null;
  events?: ConversationWorkspaceEvents;
  messageRoute?: ConversationMessageRoute;
  requestBodyExtra?: Record<string, unknown>;
  inputFooter?: React.ReactNode;
  messageTokenBadges?: readonly MessageTokenBadge[];
};

type UiMessage = {
  id: string;
  role: MessageRole;
  content: string;
};

const EXAMPLE_PROMPTS = [
  "Запомни: мой любимый цвет — синий",
  "Составь короткий план изучения TypeScript",
  "Объясни разницу между процессом и потоком",
];

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

const TOKEN_HEADER_NAMES = {
  systemTokens: "X-Token-System",
  historyTokens: "X-Token-History",
  requestTokens: "X-Token-Request",
  promptTokens: "X-Token-Prompt",
  reservedOutputTokens: "X-Token-Reserved-Output",
  contextTokens: "X-Token-Context",
  contextLimit: "X-Token-Limit",
} as const;

function readTokenBreakdown(headers: Headers): TokenBreakdown | null {
  const entries = Object.entries(TOKEN_HEADER_NAMES).map(([field, header]) => {
    const value = headers.get(header);
    const tokens = value === null ? Number.NaN : Number(value);
    return [field, tokens] as const;
  });
  if (entries.some(([, tokens]) => !Number.isSafeInteger(tokens) || tokens < 0)) {
    return null;
  }
  return Object.fromEntries(entries) as TokenBreakdown;
}

export function ConversationWorkspace({
  initialConversations,
  initialDetail,
  model,
  events,
  messageRoute = "messages",
  requestBodyExtra,
  inputFooter,
  messageTokenBadges,
}: ConversationWorkspaceProps) {
  const [conversations, setConversations] = useState(initialConversations);
  const [activeId, setActiveId] = useState(initialDetail?.conversation.id ?? null);
  const [messages, setMessages] = useState<UiMessage[]>(
    initialDetail?.messages.map((message) => ({
      id: `stored-${message.id}`,
      role: message.role,
      content: message.content,
    })) ?? [],
  );
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const transientExchangeIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function refreshConversations(): Promise<ConversationSummary[]> {
    const result = await requestJson<{ conversations: ConversationSummary[] }>(
      "/api/conversations",
    );
    setConversations(result.conversations);
    return result.conversations;
  }

  async function fetchConversation(id: string): Promise<ConversationDetail> {
    return requestJson<ConversationDetail>(`/api/conversations/${id}`);
  }

  async function createConversation(): Promise<ConversationSummary> {
    const result = await requestJson<{ conversation: ConversationSummary }>(
      "/api/conversations",
      { method: "POST" },
    );
    setConversations((current) => [result.conversation, ...current]);
    setActiveId(result.conversation.id);
    setMessages([]);
    setSidebarOpen(false);
    events?.onConversationChange?.(result.conversation.id);
    return result.conversation;
  }

  async function handleCreate() {
    if (streaming || loadingConversation) return;
    setError(null);
    setLoadingConversation(true);
    try {
      await createConversation();
      textareaRef.current?.focus();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Не удалось создать диалог.");
    } finally {
      setLoadingConversation(false);
    }
  }

  async function handleSelect(id: string) {
    if (id === activeId || streaming || loadingConversation) return;
    setError(null);
    setLoadingConversation(true);
    try {
      const detail = await fetchConversation(id);
      setActiveId(id);
      setMessages(
        detail.messages.map((message) => ({
          id: `stored-${message.id}`,
          role: message.role,
          content: message.content,
        })),
      );
      events?.onConversationChange?.(id);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Не удалось загрузить диалог.");
      await refreshConversations().catch(() => undefined);
    } finally {
      setLoadingConversation(false);
    }
  }

  async function handleDelete(id: string) {
    if (streaming || loadingConversation) return;
    setError(null);

    const response = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const message =
        payload && typeof payload === "object" && "error" in payload
          ? String(payload.error)
          : `Сервер вернул ${response.status}.`;
      setError(message);
      throw new Error(message);
    }

    const remaining = conversations.filter((conversation) => conversation.id !== id);
    setConversations(remaining);
    if (activeId !== id) return;

    const next = remaining[0];
    if (!next) {
      setActiveId(null);
      setMessages([]);
      events?.onConversationChange?.(null);
      return;
    }

    setLoadingConversation(true);
    try {
      const detail = await fetchConversation(next.id);
      setActiveId(next.id);
      setMessages(
        detail.messages.map((message) => ({
          id: `stored-${message.id}`,
          role: message.role,
          content: message.content,
        })),
      );
      events?.onConversationChange?.(next.id);
    } catch (actionError) {
      setActiveId(null);
      setMessages([]);
      events?.onConversationChange?.(null);
      setError(
        actionError instanceof Error ? actionError.message : "Не удалось загрузить следующий диалог.",
      );
      throw actionError;
    } finally {
      setLoadingConversation(false);
    }
  }

  async function restoreConversation(id: string) {
    try {
      const detail = await fetchConversation(id);
      setMessages(
        detail.messages.map((message) => ({
          id: `stored-${message.id}`,
          role: message.role,
          content: message.content,
        })),
      );
      await refreshConversations();
    } catch (restoreError) {
      setError(
        restoreError instanceof Error
          ? restoreError.message
          : "Не удалось восстановить сохранённый диалог.",
      );
    }
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || streaming || loadingConversation) return;

    setError(null);
    setStreaming(true);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    let conversationId = activeId;
    const exchangeId = ++transientExchangeIdRef.current;
    const userId = `user-pending-${exchangeId}`;
    const assistantId = `assistant-pending-${exchangeId}`;

    try {
      if (!conversationId) {
        conversationId = (await createConversation()).id;
      }

      setMessages((current) => [
        ...current,
        { id: userId, role: "user", content },
        { id: assistantId, role: "assistant", content: "" },
      ]);

      const response = await fetch(
        `/api/conversations/${encodeURIComponent(conversationId)}/${messageRoute}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...requestBodyExtra, content }),
          signal: (abortRef.current = new AbortController()).signal,
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
      events?.onResponseHeaders?.(conversationId, response.headers);

      events?.onResponseHeaders?.(conversationId, response.headers);
      const preview = readTokenBreakdown(response.headers);
      if (preview) events?.onUsagePreview?.(conversationId, preview);

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
      await refreshConversations();
      events?.onExchangeComplete?.(conversationId);
    } catch (actionError) {
      if (!(actionError instanceof DOMException && actionError.name === "AbortError")) {
        setInput(content);
        setError(actionError instanceof Error ? actionError.message : "Не удалось получить ответ.");
      }
      if (conversationId) {
        await restoreConversation(conversationId);
        events?.onExchangeFailed?.(conversationId);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function autoResize() {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 120)}px`;
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send(input);
    }
  }

  const controlsDisabled = streaming || loadingConversation;
  const activeConversation = conversations.find((conversation) => conversation.id === activeId);

  return (
    <div className="flex h-full min-h-0 overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_24px_80px_rgba(3,5,16,0.5)]">
      <ConversationSidebar
        conversations={conversations}
        activeId={activeId}
        disabled={controlsDisabled}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onCreate={() => void handleCreate()}
        onSelect={(id) => void handleSelect(id)}
        onDelete={handleDelete}
      />

      <section className="flex min-w-0 flex-1 flex-col" aria-label="Активный диалог">
        <header className="flex min-h-14 items-center gap-2 border-b border-line px-3 sm:px-4">
          <button
            type="button"
            aria-label="Открыть список диалогов"
            aria-controls="conversation-sidebar"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(true)}
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-line text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:hidden"
          >
            <ListIcon size={19} aria-hidden />
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {activeConversation?.title ?? "Новый диалог"}
            </p>
            <p className="truncate font-mono text-[10px] text-muted">
              Flash Agent · {model ?? "модель не задана"}
            </p>
          </div>
          {loadingConversation && (
            <span className="ml-auto text-xs text-muted" role="status">
              Загрузка…
            </span>
          )}
        </header>

        <div ref={scrollRef} className="chat-scroll min-h-0 flex-1 overflow-y-auto px-4 py-5">
          <div className="mx-auto flex min-h-full w-full max-w-[820px] flex-col gap-5" aria-live="polite">
            {messages.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-5 py-10 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent">
                  <LightningIcon size={28} weight="fill" aria-hidden />
                </span>
                <div>
                  <p className="font-medium">Новый разговор</p>
                  <p className="mt-1 text-sm text-muted">История сохранится в SQLite автоматически</p>
                </div>
                <div className="flex max-w-2xl flex-wrap justify-center gap-2">
                  {EXAMPLE_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      disabled={controlsDisabled}
                      onClick={() => void send(prompt)}
                      className="min-h-11 cursor-pointer rounded-xl border border-line px-4 py-2 text-sm text-muted transition-colors hover:border-accent/40 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message, index) => {
                const badge = messageTokenBadges?.[Math.floor(index / 2)];
                if (message.role === "user") {
                  return (
                    <div key={message.id} className="flex flex-col items-end gap-1">
                      <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-accent/20 bg-accent/10 px-4 py-2.5 text-sm leading-relaxed">
                        {message.content}
                      </p>
                      {badge && (
                        <span className="font-mono text-[10px] text-muted">
                          ≈ {badge.requestTokens.toLocaleString("ru-RU")} ток. · estimate
                        </span>
                      )}
                    </div>
                  );
                }

                return (
                  <div key={message.id} className="flex flex-col items-start gap-1">
                    <div className="chat-md max-w-[92%] text-sm leading-relaxed">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                      {streaming && message.id === messages.at(-1)?.id && (
                        <span className="ml-0.5 inline-block h-4 w-2 translate-y-0.5 rounded-[2px] bg-accent motion-safe:animate-pulse" />
                      )}
                    </div>
                    {badge && badge.responseTokens > 0 && (
                      <span className="font-mono text-[10px] text-muted">
                        {badge.source === "provider" ? "" : "≈ "}
                        {badge.responseTokens.toLocaleString("ru-RU")} ток. ·{" "}
                        {badge.source}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {error && (
          <div className="mx-auto mb-2 w-[calc(100%-2rem)] max-w-[820px] rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs leading-relaxed text-red-200" role="alert">
            {error}
          </div>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send(input);
          }}
          className="border-t border-line px-3 py-3"
        >
          <div className="mx-auto flex w-full max-w-[820px] items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onInput={autoResize}
              onKeyDown={onInputKeyDown}
              enterKeyHint="send"
              rows={1}
              placeholder="Сообщение агенту"
              aria-label="Сообщение агенту"
              className="min-h-11 flex-1 resize-none rounded-xl border border-line bg-background px-3 py-2.5 text-sm leading-relaxed placeholder:text-muted/70 focus:border-accent/50 focus:outline-none"
            />
            {streaming ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                aria-label="Остановить генерацию"
                className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-line text-foreground transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <StopIcon size={18} weight="fill" aria-hidden />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim() || loadingConversation}
                aria-label="Отправить"
                className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-accent-deep text-white transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                <PaperPlaneRightIcon size={18} weight="fill" aria-hidden />
              </button>
            )}
          </div>
          {inputFooter && (
            <div className="mx-auto w-full max-w-[820px] pt-2">{inputFooter}</div>
          )}
        </form>
      </section>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Lightning, PaperPlaneRight, Plus, Stop } from "@phosphor-icons/react";

type Message = { role: "user" | "assistant"; content: string };

const EXAMPLE_PROMPTS = [
  "Объясни event loop в JavaScript в трёх абзацах",
  "Напиши SQL-запрос: топ-5 клиентов по сумме заказов",
  "Предложи структуру README для pet-проекта",
];

export function Chat({ model }: { model: string | null }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || streaming) return;

    const history: Message[] = [...messages, { role: "user", content }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setError(null);
    setStreaming(true);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
        signal: controller.signal,
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
        const delta = decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, content: last.content + delta };
          return next;
        });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // остановлено пользователем: частичный ответ оставляем, пустой пузырь убираем
        setMessages((prev) =>
          prev[prev.length - 1]?.content === "" ? prev.slice(0, -1) : prev,
        );
      } else {
        setMessages(history.slice(0, -1));
        setInput(content);
        setError(err instanceof Error ? err.message : "Неизвестная ошибка.");
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  const lastIndex = messages.length - 1;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_24px_80px_rgba(3,5,16,0.5)]">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="font-mono text-xs text-muted">{model ?? "модель не задана"}</span>
        {messages.length > 0 && !streaming && (
          <button
            type="button"
            onClick={() => {
              setMessages([]);
              setError(null);
            }}
            className="flex items-center gap-1.5 rounded-xl border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-accent hover:text-white active:scale-[0.98]"
          >
            <Plus size={14} weight="bold" />
            Новый диалог
          </button>
        )}
      </div>

      <div ref={scrollRef} className="chat-scroll flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex h-full w-full max-w-[960px] flex-col gap-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent">
              <Lightning size={28} weight="fill" />
            </span>
            <p className="text-base text-muted">Задайте вопрос или выберите пример</p>
            <div className="flex max-w-[860px] flex-wrap justify-center gap-2 px-4">
              {EXAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => void send(prompt)}
                  className="rounded-xl border border-line px-4 py-2.5 text-sm text-muted transition-colors hover:border-accent/40 hover:text-foreground active:scale-[0.98]"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) =>
            msg.role === "user" ? (
              <div key={i} className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-accent/20 bg-accent/10 px-4 py-2.5 text-sm leading-relaxed">
                  {msg.content}
                </p>
              </div>
            ) : (
              <div key={i} className="flex">
                <div className="chat-md max-w-[92%] text-sm leading-relaxed">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  {streaming && i === lastIndex && (
                    <span className="ml-0.5 inline-block h-4 w-2 translate-y-0.5 rounded-[2px] bg-accent motion-safe:animate-pulse" />
                  )}
                </div>
              </div>
            ),
          )
        )}
        </div>
      </div>

      {error && (
        <div className="mx-auto mb-2 w-[calc(100%-2rem)] max-w-[960px] rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs leading-relaxed text-red-200">
          {error}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="border-t border-line px-3 py-3"
      >
        <div className="mx-auto flex w-full max-w-[960px] items-end gap-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onInput={autoResize}
          onKeyDown={onKeyDown}
          enterKeyHint="send"
          rows={1}
          placeholder="Сообщение для модели"
          aria-label="Сообщение для модели"
          className="flex-1 resize-none rounded-xl border border-line bg-background px-3 py-2.5 text-sm leading-relaxed placeholder:text-muted/70 focus:border-accent/50 focus:outline-none"
        />
        {streaming ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            aria-label="Остановить генерацию"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line text-foreground transition-colors hover:bg-white/5 active:scale-[0.98]"
          >
            <Stop size={18} weight="fill" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            aria-label="Отправить"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-deep text-white transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.98]"
          >
            <PaperPlaneRight size={18} weight="fill" />
          </button>
        )}
        </div>
      </form>
    </div>
  );
}

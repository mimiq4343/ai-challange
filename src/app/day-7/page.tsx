import type { Metadata } from "next";
import { ConversationWorkspace } from "@/components/conversation-workspace";
import { SiteHeader } from "@/components/site-header";
import { getConversationStore } from "@/lib/conversation-store";
import type { ConversationDetail } from "@/lib/conversation-types";

export const metadata: Metadata = {
  title: "Flash Chat · Day 7",
  description:
    "AI-агент сохраняет несколько диалогов в SQLite и восстанавливает контекст после перезапуска.",
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function Day7() {
  const store = getConversationStore();
  const initialConversations = store.listConversations();
  const activeConversation = initialConversations[0] ?? null;
  const initialDetail: ConversationDetail | null = activeConversation
    ? {
        conversation: activeConversation,
        messages: store.getMessages(activeConversation.id),
      }
    : null;
  const model = process.env.OPENAI_MODEL ?? null;

  return (
    <div className="relative w-full flex-1">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[85vh] bg-[radial-gradient(70vw_60vh_at_42%_0%,rgba(77,107,254,0.14),transparent_70%)]"
      />
      <div className="w-full px-[clamp(0.75rem,2vw,2rem)] pb-4">
        <SiteHeader />
        <main className="mx-auto flex h-[calc(100dvh-5rem)] min-h-[620px] w-full max-w-[1280px] flex-col gap-3">
          <div className="rise-in flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
            <div>
              <p className="inline-flex items-center rounded-full border border-accent/25 bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-accent">
                AI Advent Challenge #9 · Day 7
              </p>
              <h1 className="mt-2 text-[clamp(1.35rem,0.8vw+1rem,1.9rem)] font-bold leading-tight tracking-tight">
                Контекст, который переживает рестарт
              </h1>
            </div>
            <p className="max-w-[52ch] text-xs leading-relaxed text-muted sm:text-right">
              Каждый законченный обмен хранится в SQLite. Выберите старый диалог и
              продолжайте с того же места.
            </p>
          </div>
          <div className="rise-in-delayed min-h-0 flex-1">
            <ConversationWorkspace
              initialConversations={initialConversations}
              initialDetail={initialDetail}
              model={model}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

import type { Metadata } from "next";

import { Day11Workspace } from "@/components/day11-workspace";
import { SiteHeader } from "@/components/site-header";
import { getConversationStore } from "@/lib/conversation-store";
import type { ConversationDetail } from "@/lib/conversation-types";
import { getMemorySnapshot } from "@/lib/memory";
import { getConversationAnalytics } from "@/lib/token-analytics";

export const metadata: Metadata = {
  title: "Flash Chat · Day 11",
  description:
    "Явная модель памяти агента: краткосрочная, рабочая и долговременная — отдельные слои с ручным управлением.",
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Day11() {
  const store = getConversationStore();
  const initialConversations = store.listConversations();
  const activeConversation = initialConversations[0] ?? null;
  const initialDetail: ConversationDetail | null = activeConversation
    ? {
        conversation: activeConversation,
        messages: store.getMessages(activeConversation.id),
      }
    : null;
  const [initialAnalytics, initialMemory] = await Promise.all([
    activeConversation ? getConversationAnalytics(store, activeConversation.id) : null,
    getMemorySnapshot(store, activeConversation?.id ?? null),
  ]);

  return (
    <div className="relative w-full flex-1">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[90vh] bg-[radial-gradient(75vw_65vh_at_70%_0%,rgba(77,107,254,0.16),transparent_72%)]"
      />
      <div className="w-full px-[clamp(0.75rem,1.5vw,1.5rem)] pb-4">
        <SiteHeader />
        <main className="mx-auto flex h-[calc(100dvh-5rem)] min-h-[680px] w-full max-w-[1600px] flex-col gap-3">
          <div className="rise-in flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
            <div>
              <p className="inline-flex items-center rounded-full border border-accent/25 bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-accent">
                AI Advent Challenge #9 · Day 11
              </p>
              <h1 className="mt-2 text-[clamp(1.35rem,0.8vw+1rem,1.9rem)] font-bold leading-tight tracking-tight">
                Модель памяти агента
              </h1>
            </div>
            <p className="max-w-[58ch] text-xs leading-relaxed text-muted sm:text-right">
              Краткосрочная, рабочая и долговременная память хранятся отдельно. Что
              сохранить и куда — выбираете вы; панель справа показывает точный текст,
              который попадает в system prompt.
            </p>
          </div>
          <div className="min-h-0 flex-1">
            <Day11Workspace
              initialConversations={initialConversations}
              initialDetail={initialDetail}
              initialAnalytics={initialAnalytics}
              initialMemory={initialMemory}
              model={process.env.OPENAI_MODEL ?? null}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

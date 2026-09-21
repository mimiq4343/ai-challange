import type { Metadata } from "next";

import { Day13Workspace } from "@/components/day13-workspace";
import { SiteHeader } from "@/components/site-header";
import { getConversationStore } from "@/lib/conversation-store";
import type { ConversationDetail } from "@/lib/conversation-types";
import { SHORT_TERM_WINDOW_MESSAGES } from "@/lib/memory-composer";
import { getMemoryStore } from "@/lib/memory-store";
import { getProfileStore } from "@/lib/profile-store";
import { getTaskStore } from "@/lib/task-store";
import { getConversationAnalytics } from "@/lib/token-analytics";

export const metadata: Metadata = {
  title: "Flash Chat · Day 13",
  description:
    "Состояние задачи как конечный автомат: этап, текущий шаг и ожидаемое действие.",
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Day13() {
  const store = getConversationStore();
  const memory = getMemoryStore();
  const profile = getProfileStore().getActiveProfile();
  const task = getTaskStore().getSnapshot(profile.id);
  const initialConversations = store.listConversations();
  const activeConversation = initialConversations[0] ?? null;
  const messages = activeConversation ? store.getMessages(activeConversation.id) : [];
  const initialDetail: ConversationDetail | null = activeConversation
    ? { conversation: activeConversation, messages }
    : null;
  const initialMemory = activeConversation
    ? memory.getSnapshot(activeConversation.id, profile.id, {
        windowMessages: SHORT_TERM_WINDOW_MESSAGES,
        totalMessages: messages.length,
        includedMessages: Math.min(messages.length, SHORT_TERM_WINDOW_MESSAGES),
      })
    : null;
  const analytics = activeConversation
    ? await getConversationAnalytics(store, activeConversation.id)
    : null;

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
                AI Advent Challenge #9 · Day 13
              </p>
              <h1 className="mt-2 text-[clamp(1.35rem,0.8vw+1rem,1.9rem)] font-bold leading-tight tracking-tight">
                Задача как конечный автомат
              </h1>
            </div>
            <p className="max-w-[58ch] text-xs leading-relaxed text-muted sm:text-right">
              Этап, текущий шаг и ожидаемое действие живут в базе. Пауза замораживает
              автомат, а продолжение не требует повторных объяснений.
            </p>
          </div>
          <div className="min-h-0 flex-1">
            <Day13Workspace
              initialConversations={initialConversations}
              initialDetail={initialDetail}
              initialMemory={initialMemory}
              initialTask={task}
              initialTotalCostMicrosUsd={analytics?.totals.costMicrosUsd ?? 0}
              shortTermWindow={SHORT_TERM_WINDOW_MESSAGES}
              model={process.env.OPENAI_MODEL ?? null}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

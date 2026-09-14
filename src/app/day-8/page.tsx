import type { Metadata } from "next";

import { Day8Workspace } from "@/components/day8-workspace";
import { SiteHeader } from "@/components/site-header";
import { getConversationStore } from "@/lib/conversation-store";
import { getComparisonScenarios, getConversationAnalytics } from "@/lib/token-analytics";
import type { ConversationDetail } from "@/lib/conversation-types";

export const metadata: Metadata = {
  title: "Flash Chat · Day 8",
  description:
    "Гибридный подсчёт токенов, стоимость контекста и реальный overflow-тест OpenRouter.",
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Day8() {
  const store = getConversationStore();
  const initialConversations = store.listConversations();
  const activeConversation = initialConversations[0] ?? null;
  const initialDetail: ConversationDetail | null = activeConversation
    ? {
        conversation: activeConversation,
        messages: store.getMessages(activeConversation.id),
      }
    : null;
  const [initialAnalytics, initialComparison] = await Promise.all([
    activeConversation ? getConversationAnalytics(store, activeConversation.id) : null,
    getComparisonScenarios(store),
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
                AI Advent Challenge #9 · Day 8
              </p>
              <h1 className="mt-2 text-[clamp(1.35rem,0.8vw+1rem,1.9rem)] font-bold leading-tight tracking-tight">
                Сколько стоит растущий контекст
              </h1>
            </div>
            <p className="max-w-[58ch] text-xs leading-relaxed text-muted sm:text-right">
              Локальная оценка до запроса. Фактический provider usage и стоимость — после
              полного ответа.
            </p>
          </div>
          <div className="min-h-0 flex-1">
            <Day8Workspace
              initialConversations={initialConversations}
              initialDetail={initialDetail}
              initialAnalytics={initialAnalytics}
              initialComparison={initialComparison}
              model={process.env.OPENAI_MODEL ?? null}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

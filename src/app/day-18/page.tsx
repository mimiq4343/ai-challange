import type { Metadata } from "next";

import { Day15Workspace } from "@/components/day15-workspace";
import { SchedulerPanel } from "@/components/scheduler-panel";
import { SiteHeader } from "@/components/site-header";
import { getConversationStore } from "@/lib/conversation-store";
import type { ConversationDetail } from "@/lib/conversation-types";
import { getInvariantStore } from "@/lib/invariant-store";
import { SHORT_TERM_WINDOW_MESSAGES } from "@/lib/memory-composer";
import { getMemoryStore } from "@/lib/memory-store";
import { getProfileStore } from "@/lib/profile-store";
import { SCHEDULER_LIMITS } from "@/lib/scheduler-config";
import { getSchedulerStore } from "@/lib/scheduler-store";
import { getTaskStore } from "@/lib/task-store";
import { getConversationAnalytics } from "@/lib/token-analytics";

export const metadata: Metadata = {
  title: "Flash Chat · Day 18",
  description: "Автономный мониторинг GitHub: агент создаёт расписания через MCP, а независимый worker собирает данные и публикует сводки DeepSeek.",
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EXAMPLE_PROMPTS = [
  "Следи за репозиторием vercel/next.js каждый час. Создай расписание мониторинга.",
  "Покажи список моих задач мониторинга GitHub и время следующего запуска.",
  "Покажи сводку по мониторингу vercel/next.js за последние 24 часа.",
];

export default async function Day18() {
  const store = getConversationStore();
  const memory = getMemoryStore();
  const profile = getProfileStore().getActiveProfile();
  const taskStore = getTaskStore();
  const scheduler = getSchedulerStore();
  const initialSnapshot = {
    jobs: scheduler.list(profile.id),
    runs: scheduler.listRuns(profile.id, undefined, SCHEDULER_LIMITS.feedLimit),
  };
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
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[90vh] bg-[radial-gradient(75vw_65vh_at_70%_0%,rgba(77,107,254,0.16),transparent_72%)]" />
      <div className="w-full px-[clamp(0.75rem,1.5vw,1.5rem)] pb-4">
        <SiteHeader />
        <main className="flex h-[calc(100dvh-5rem)] min-h-[680px] w-full flex-col gap-3">
          <div className="rise-in flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0">
              <p className="inline-flex items-center rounded-full border border-accent/25 bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-accent">
                AI Advent Challenge #9 · Day 18
              </p>
              <h1 className="mt-2 text-[clamp(1.35rem,0.8vw+1rem,1.9rem)] font-bold leading-tight tracking-tight">GitHub под наблюдением агента</h1>
            </div>
            <p className="max-w-[62ch] text-xs leading-relaxed text-muted sm:text-right">
              Попросите следить за репозиторием. Первый замер — сразу, затем worker работает независимо от чата.
              Сводки — в панели мониторинга. Память, задачи и инварианты сохранены.
            </p>
          </div>
          <div className="min-h-0 flex-1">
            <Day15Workspace
              key={profile.id}
              initialConversations={initialConversations}
              initialDetail={initialDetail}
              initialMemory={initialMemory}
              initialTask={taskStore.getSnapshot(profile.id)}
              initialProposal={taskStore.getProposal(profile.id)}
              initialInvariants={getInvariantStore().getSnapshot(profile.id)}
              initialTotalCostMicrosUsd={analytics?.totals.costMicrosUsd ?? 0}
              shortTermWindow={SHORT_TERM_WINDOW_MESSAGES}
              model={process.env.OPENAI_MODEL ?? null}
              messageRoute="scheduled-messages"
              examplePrompts={EXAMPLE_PROMPTS}
              inspectorExtra={<SchedulerPanel key={profile.id} initialSnapshot={initialSnapshot} profileId={profile.id} profileName={profile.name} />}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

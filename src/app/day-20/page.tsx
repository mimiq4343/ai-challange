import type { Metadata } from "next";

import { Day15Workspace } from "@/components/day15-workspace";
import { OrchestrationPanel, type RegisteredServerView } from "@/components/orchestration-panel";
import { SiteHeader } from "@/components/site-header";
import { getConversationStore } from "@/lib/conversation-store";
import type { ConversationDetail } from "@/lib/conversation-types";
import { getInvariantStore } from "@/lib/invariant-store";
import { SHORT_TERM_WINDOW_MESSAGES } from "@/lib/memory-composer";
import { getMemoryStore } from "@/lib/memory-store";
import { ORCHESTRATION_SERVERS } from "@/lib/orchestration-config";
import { getOrchestrationStore } from "@/lib/orchestration-run-store";
import { allowedOrchestrationTools } from "@/lib/orchestration-tools";
import { getProfileStore } from "@/lib/profile-store";
import { getTaskStore } from "@/lib/task-store";
import { getConversationAnalytics } from "@/lib/token-analytics";

export const metadata: Metadata = {
  title: "Flash Chat · Day 20",
  description: "Оркестрация нескольких MCP-серверов: агент сам выбирает инструменты Flash, DeepWiki, пайплайна и планировщика и выполняет длинный флоу.",
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EXAMPLE_PROMPTS = [
  "Подбери TypeScript-библиотеку для SQLite: найди кандидатов, проверь свежие данные лидера, выясни через DeepWiki, как у него устроены миграции, сохрани отчёт в файл и поставь лидера на мониторинг каждый час.",
  "Проверь актуальные звёзды drizzle-team/drizzle-orm и спроси DeepWiki, как в нём реализованы миграции.",
  "Какие мониторинги репозиториев сейчас запущены? Для первого покажи сводку за сутки.",
];

const SERVERS: RegisteredServerView[] = ORCHESTRATION_SERVERS.map((server) => ({
  ...server, allowedTools: allowedOrchestrationTools(server.id),
}));

export default async function Day20() {
  const store = getConversationStore();
  const memory = getMemoryStore();
  const profile = getProfileStore().getActiveProfile();
  const taskStore = getTaskStore();
  const latestRun = getOrchestrationStore().latestRun(profile.id);
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
                AI Advent Challenge #9 · Day 20
              </p>
              <h1 className="mt-2 text-[clamp(1.35rem,0.8vw+1rem,1.9rem)] font-bold leading-tight tracking-tight">Оркестрация нескольких MCP-серверов</h1>
            </div>
            <p className="max-w-[62ch] text-xs leading-relaxed text-muted sm:text-right">
              Один запрос — длинный флоу: агент сам выбирает инструменты четырёх серверов, включая внешний DeepWiki,
              и выполняет шаги в порядке зависимостей. Маршрут каждого запуска — в панели справа.
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
              messageRoute="orchestrated-messages"
              examplePrompts={EXAMPLE_PROMPTS}
              inspectorExtra={<OrchestrationPanel key={profile.id} servers={SERVERS} run={latestRun} profileName={profile.name} />}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

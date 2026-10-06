"use client";

import { useState } from "react";
import { ConversationWorkspace } from "@/components/conversation-workspace";
import type { ConversationSummary } from "@/lib/conversation-types";
import { emptyRagTaskState, type RagChatSnapshot } from "@/lib/rag-chat-types";
import { REFINEMENT_CONFIG } from "@/lib/rag-refinement-config";

export function RagChatWorkspace({ initialConversations, initialDetail, model }: {
  initialConversations: ConversationSummary[]; initialDetail: RagChatSnapshot | null; model: string | null;
}) {
  const [memory, setMemory] = useState(initialDetail?.taskState ?? emptyRagTaskState());
  return <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_clamp(16rem,23vw,24rem)]">
    <div className="h-[clamp(30rem,75dvh,70rem)] min-w-0">
      <ConversationWorkspace initialConversations={initialConversations} initialDetail={initialDetail} model={model}
        messageRoute="rag-messages" requestBodyExtra={{ settings: REFINEMENT_CONFIG.settings }}
        events={{ onDetail: (detail) => { if (detail.taskState) setMemory(detail.taskState); }, onConversationChange: (id) => { if (!id) setMemory(emptyRagTaskState()); } }}
        examplePrompts={["Цель: разобраться в сохранении истории Day 7. Откуда PersistentChatAgent берёт прошлые сообщения?", "Цель: проверить задачи Flash Chat. Когда разрешён переход planning в execution?"]}
        inputFooter={<p className="text-xs leading-relaxed text-muted">Каждый вопрос проходит поиск. История, источники и память сохраняются после полного ответа.</p>} />
    </div>
    <aside className="min-w-0 rounded-2xl border border-line bg-surface p-4" aria-label="Память задачи">
      <h2 className="font-semibold text-accent">Память задачи</h2>
      <p className="mt-2 text-xs leading-relaxed text-muted">Уточнения этого диалога. Чтобы изменить цель или условие, напишите исправление в чат.</p>
      <section className="mt-5"><h3 className="text-sm font-medium">Цель диалога</h3>
        <p className="mt-2 break-words text-sm leading-relaxed [overflow-wrap:anywhere]">{memory.goal?.value ?? "Пока не зафиксирована"}</p>
        {memory.goal && <p className="mt-1 text-xs text-muted">Из сообщения пользователя №{memory.goal.turn}</p>}
      </section>
      {([ ["clarifications", "Что уточнено"], ["constraints", "Ограничения"], ["terms", "Термины"] ] as const).map(([kind, title]) => <section key={kind} className="mt-5 border-t border-line pt-4">
        <h3 className="text-sm font-medium">{title}</h3>
        {!memory[kind].length ? <p className="mt-2 text-xs text-muted">Пока нет</p> : <ul className="mt-2 space-y-3">
          {memory[kind].map((entry) => <li key={entry.key} className="break-words text-sm leading-relaxed [overflow-wrap:anywhere]">
            <p><span className="font-medium">{entry.key}:</span> {entry.value}</p>
            <details className="mt-1 text-xs text-muted"><summary className="flex min-h-11 cursor-pointer items-center rounded-lg focus-visible:outline-2 focus-visible:outline-accent">Уточнение из сообщения №{entry.turn}</summary><blockquote className="border-l-2 border-accent/40 pl-2">{entry.evidence}</blockquote></details>
          </li>)}
        </ul>}
      </section>)}
    </aside>
  </div>;
}

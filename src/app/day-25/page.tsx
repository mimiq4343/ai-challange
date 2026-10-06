import { RagChatWorkspace } from "@/components/rag-chat-workspace";
import { SiteHeader } from "@/components/site-header";
import { getConversationStore } from "@/lib/conversation-store";
import { readRagChatBenchmark } from "@/lib/rag-chat-benchmark";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Day25Page() {
  const store = getConversationStore();
  const conversations = store.listConversations();
  const detail = conversations.length ? store.getRagChat(conversations[0].id) : null;
  const report = await readRagChatBenchmark();
  return <div className="relative min-h-screen overflow-x-clip bg-background text-foreground">
    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_15%_0%,rgba(99,102,241,0.12),transparent_65%),radial-gradient(ellipse_at_90%_80%,rgba(139,92,246,0.08),transparent_72%)]" />
    <div className="relative w-full px-[clamp(0.75rem,1.5vw,1.5rem)] pb-8"><SiteHeader /><main className="space-y-5">
      <div className="rise-in flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div className="min-w-0"><p className="inline-flex rounded-full border border-accent/25 bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-accent">AI Advent Challenge #9 · Day 25</p><h1 className="mt-2 text-[clamp(1.35rem,0.8vw+1rem,1.9rem)] font-bold leading-tight tracking-tight">Чат с RAG и памятью</h1></div><p className="max-w-[65ch] text-xs leading-relaxed text-muted sm:text-right">История диалога, поиск на каждом вопросе, проверяемые источники и сохранённая цель задачи.</p></div>
      <RagChatWorkspace initialConversations={conversations} initialDetail={detail} model={process.env.OPENAI_MODEL ?? null} />
      {report && <section className="rounded-2xl border border-line bg-surface p-4" aria-label="Проверка длинных диалогов">
        <h2 className="font-semibold">Последняя проверка длинных диалогов</h2>
        <p className="mt-2 text-xs text-muted">Два сценария по 12 пользовательских ходов. Оценка смысла выполнена той же моделью и носит ориентировочный характер.</p>
        <ul className="mt-3 grid gap-3 md:grid-cols-2">{report.scenarios.map((scenario) => <li key={scenario.id} className="min-w-0 rounded-xl border border-line p-3 text-sm leading-relaxed">
          <h3 className="font-medium">{scenario.title}</h3>
          <p className="mt-2 text-muted">Цель сохранена: {scenario.turns.filter((turn) => turn.judge.goalRetained).length}/12. Ограничения соблюдены: {scenario.turns.filter((turn) => turn.judge.constraintsRespected).length}/12.</p>
          <p className="mt-1 text-muted">Термины учтены: {scenario.turns.filter((turn) => turn.judge.termsCorrect).length}/12. Текущий вопрос учтён: {scenario.turns.filter((turn) => turn.judge.followsQuestion).length}/12.</p>
          <p className="mt-1 text-muted">Источники на вопросы по корпусу: {scenario.turns.filter((turn) => !turn.expectUnknown && turn.checks.hasSources).length}/{scenario.turns.filter((turn) => !turn.expectUnknown).length}. Восстановление после открытия базы заново: {scenario.restoredAfterReopen ? "проверено" : "не прошло"}.</p>
        </li>)}</ul>
      </section>}
    </main></div>
  </div>;
}

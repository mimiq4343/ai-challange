import { RagAnswerCard } from "@/components/rag-answer-card";
import { REFINEMENT_LABELS } from "@/lib/rag-refinement-config";
import type { RefinementAnswer } from "@/lib/rag-refinement-types";
import type { GroundedQuote } from "@/lib/rag-grounding-types";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function RagRefinementAnswerCard({ answer, title, quotes }: { answer: RefinementAnswer; title?: string; quotes?: GroundedQuote[] }) {
  const { result } = answer;
  return (
    <div className="min-w-0 space-y-3">
      <RagAnswerCard result={result} title={title ?? REFINEMENT_LABELS[answer.mode]} quotes={quotes} />
      <details className="min-w-0 rounded-2xl border border-line bg-background">
        <summary className={`min-h-11 cursor-pointer rounded-2xl p-4 text-sm leading-relaxed ${FOCUS_RING}`}>
          Поиск и отбор: найдено {answer.candidates.length}, в контекст передано {answer.candidates.filter((candidate) => candidate.decision === "selected").length}
          <span className="mt-1 block text-xs text-muted">Всего {(answer.durationMs / 1000).toFixed(1)} с · {answer.usage.totalTokens} токенов с учётом обработки</span>
        </summary>
        <div className="space-y-4 border-t border-line p-4 text-xs leading-relaxed">
          <p className="break-words [overflow-wrap:anywhere]"><span className="text-muted">Поисковый запрос: </span>{answer.query}</p>
          <p className="text-muted">Top-K до: {answer.settings.candidateK} · после: {answer.settings.contextK}{answer.mode === "refined" ? ` · порог: ${answer.settings.minRelevance}/10` : " · без отсечения по релевантности"}.</p>
          {answer.stages.map((stage) => <p key={stage.id} className="text-muted">{stage.kind === "rewrite" ? "Query rewrite" : "Реранкинг"}: {(stage.durationMs / 1000).toFixed(1)} с · вход {stage.usage.promptTokens}, выход {stage.usage.completionTokens} токенов.</p>)}
          {!answer.candidates.some((candidate) => candidate.decision === "selected") && <p className="text-amber-300">Все фрагменты отсеяны. В ответ не передан контекст из базы.</p>}
          <ol className="space-y-2">
            {answer.candidates.map((candidate) => {
              const selected = result.sources.find((source) => source.chunkId === candidate.source.chunkId);
              const decision = candidate.decision === "selected" ? selected ? `Передан [${selected.id}]` : "Передан в контекст; не использован в ответе" : candidate.decision === "below_threshold" ? "Отсеян: ниже порога" : "Отсеян: за пределами top-K";
              return <li key={candidate.source.chunkId} className="min-w-0 rounded-xl border border-line bg-surface p-3">
                <p className={`break-words [overflow-wrap:anywhere] ${candidate.decision === "selected" ? "text-accent" : "text-muted"}`}>{candidate.source.id} · {decision}</p>
                <p className="mt-1 break-words [overflow-wrap:anywhere]">{candidate.source.source} · {candidate.source.section}</p>
                <p className="mt-1 text-muted">Сходство {candidate.source.score.toFixed(3)}{candidate.relevance !== null ? ` · релевантность ${candidate.relevance}/10` : ""}.</p>
                {candidate.reason && <p className="mt-1 break-words text-muted [overflow-wrap:anywhere]">{candidate.reason}</p>}
                <details className="mt-2">
                  <summary className={`flex min-h-11 cursor-pointer items-center rounded-lg text-accent ${FOCUS_RING}`}>Показать текст фрагмента {candidate.source.id}</summary>
                  <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs [overflow-wrap:anywhere]">{candidate.source.text}</pre>
                </details>
              </li>;
            })}
          </ol>
        </div>
      </details>
    </div>
  );
}

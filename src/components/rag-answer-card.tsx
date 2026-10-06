import { useId } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { RagAnswer } from "@/lib/rag-types";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function RagAnswerCard({ result, title }: { result: RagAnswer; title?: string }) {
  const prefix = useId();
  return (
    <article className="min-w-0 rounded-2xl border border-line bg-background p-4">
      <h3 className="font-semibold text-accent">{title ?? (result.mode === "rag" ? "С RAG" : "Без RAG")}</h3>
      <p className="mt-2 text-xs leading-relaxed text-muted">{result.model} · {(result.durationMs / 1000).toFixed(1)} с · вход {result.usage.promptTokens}, выход {result.usage.completionTokens} токенов</p>
      {result.mode === "rag" && <p className="mt-1 text-xs text-muted">Поиск {(result.retrievalMs / 1000).toFixed(1)} с · {result.sources.length} фрагментов · эмбеддинг {result.embeddingTokens} токенов</p>}
      <div className="prose prose-sm prose-invert mt-4 max-w-none min-w-0 break-words [overflow-wrap:anywhere] [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:overflow-x-auto">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.answer}</ReactMarkdown>
      </div>
      {result.invalidCitations.length > 0 && <p className="mt-3 text-sm text-amber-300">Модель сослалась на отсутствующие источники: {result.invalidCitations.map((id) => `[${id}]`).join(", ")}.</p>}
      {result.mode === "rag" && <div className="mt-5 border-t border-line pt-4">
        <h4 className="text-sm font-medium">Найденные источники</h4>
        <p className="mt-1 text-xs text-muted">«Использован» означает, что модель указала ID в ответе; это не проверка достоверности утверждения.</p>
        <div className="mt-3 space-y-2">
          {result.sources.map((source) => <details key={source.id} id={`${prefix}-${source.id}`} className="min-w-0 rounded-xl border border-line bg-surface">
            <summary className={`min-h-11 cursor-pointer break-words rounded-xl p-3 text-xs leading-relaxed ${FOCUS_RING}`}>
              <span className="font-medium text-foreground">[{source.id}] {source.source}</span>
              <span className="mt-1 block text-muted">{source.section} · строки {source.startLine}–{source.endLine} · сходство {source.score.toFixed(3)}{result.citations.includes(source.id) ? " · использован" : ""}</span>
            </summary>
            <pre className="border-t border-line p-3 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed [overflow-wrap:anywhere]">{source.text}</pre>
          </details>)}
        </div>
      </div>}
    </article>
  );
}

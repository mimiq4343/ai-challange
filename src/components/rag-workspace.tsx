"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { RagAnswerCard } from "@/components/rag-answer-card";
import { RAG_CONFIG } from "@/lib/rag-config";
import questions from "@/lib/rag-questions.json";
import type { RagAnswer, RagBenchmarkCase, RagBenchmarkReport, RagRequestMode } from "@/lib/rag-types";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const BUTTON = `min-h-11 min-w-11 cursor-pointer rounded-xl border border-line px-4 text-sm transition-colors hover:border-accent/40 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`;
const CARD = "min-w-0 rounded-2xl border border-line bg-surface p-4 sm:p-6";

function scores(item: RagBenchmarkCase) {
  return { plain: item.labelA === "plain" ? item.judge.a : item.judge.b, rag: item.labelA === "rag" ? item.judge.a : item.judge.b };
}

export function RagWorkspace({ initialReport, indexId, model }: { initialReport: RagBenchmarkReport | null; indexId: string | null; model: string | null }) {
  const [question, setQuestion] = useState(questions[0].question);
  const [ragEnabled, setRagEnabled] = useState(true);
  const [answers, setAnswers] = useState<RagAnswer[]>([]);
  const [busy, setBusy] = useState<"question" | "benchmark" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [report, setReport] = useState(initialReport);
  const [progressCases, setProgressCases] = useState<RagBenchmarkCase[]>([]);
  const requestRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => () => requestRef.current?.abort(), []);

  function begin(kind: "question" | "benchmark") {
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(kind);
    setError(null);
    setNotice(null);
    return controller;
  }

  async function ask(mode: RagRequestMode) {
    if (busy || !question.trim()) return;
    const content = question.trim();
    const controller = begin("question");
    setAnswers((current) => current.filter((item) => item.question === content));
    try {
      const response = await fetch("/api/rag", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: content, mode }), signal: controller.signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Не удалось получить ответ.");
      if (!Array.isArray(payload.answers) || !payload.answers.length || payload.answers.some((item: RagAnswer) => item.question !== content || typeof item.answer !== "string")) throw new Error("Недействительный ответ агента.");
      if (!controller.signal.aborted) setAnswers((current) => [...current.filter((item) => item.question === content && !payload.answers.some((next: RagAnswer) => next.mode === item.mode)), ...payload.answers].sort((a, b) => a.mode.localeCompare(b.mode)));
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось получить ответ.");
    } finally {
      if (requestRef.current === controller) { requestRef.current = null; setBusy(null); }
    }
  }

  async function benchmark() {
    if (busy) return;
    const controller = begin("benchmark");
    setProgressCases([]);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch("/api/rag/benchmark", { method: "POST", signal: controller.signal });
      if (!response.ok) { const payload = await response.json(); throw new Error(typeof payload.error === "string" ? payload.error : "Сравнение недоступно."); }
      if (!response.body) throw new Error("Нет потока сравнения.");
      reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let buffer = "";
      let complete = false;
      const accept = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line);
        if (event.type === "error") throw new Error(event.error);
        if (event.type === "case") setProgressCases((current) => [...current, event.item]);
        if (event.type === "complete") { complete = true; setReport(event.report); setProgressCases([]); setNotice("Все 10 вопросов обработаны. Отчёт сохранён."); }
      };
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        buffer += decoder.decode(part.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) accept(line);
      }
      buffer += decoder.decode();
      if (buffer.trim()) accept(buffer);
      if (!complete) throw new Error("Поток прервался до завершения сравнения. Предыдущий отчёт сохранён.");
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Сравнение не завершено.");
    } finally {
      if (reader) {
        try { await reader.cancel(); } catch { /* Ошибка отменённого потока уже обработана выше. */ }
        finally { reader.releaseLock(); }
      }
      if (requestRef.current === controller) { requestRef.current = null; setBusy(null); }
    }
  }

  function cancel() {
    requestRef.current?.abort();
    setNotice("Запрос остановлен. Незавершённое сравнение не заменяет сохранённый отчёт.");
  }

  function submit(event: FormEvent) { event.preventDefault(); void ask(ragEnabled ? "rag" : "plain"); }
  const displayedCases = busy === "benchmark" || progressCases.length > 0 ? progressCases : report?.cases ?? [];
  const isSavedReport = Boolean(report && displayedCases === report.cases);
  const mean = (mode: "plain" | "rag", key: "overall" | "factualAccuracy" | "completeness") => displayedCases.length ? (displayedCases.reduce((sum, item) => sum + scores(item)[mode][key], 0) / displayedCases.length).toFixed(1) : "—";

  return (
    <div className="space-y-5">
      <section className={CARD} aria-labelledby="question-heading">
        <h2 id="question-heading" className="text-lg font-semibold">Вопрос агенту</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">Каждый вопрос отправляется без истории. С RAG агент ищет пять структурных чанков и отвечает с опорой на них. Без RAG получает только вопрос. Модель: {model ?? "не настроена"}.</p>
        {!indexId && <p className="mt-3 text-sm text-amber-300">Индекс пока не создан. Режим без RAG доступен; для поиска выполните <code>npm run rag:index</code>.</p>}
        <form onSubmit={submit} className="mt-4 space-y-3">
          <label htmlFor="rag-question" className="text-sm text-muted">Ваш вопрос</label>
          <textarea ref={textareaRef} id="rag-question" value={question} disabled={Boolean(busy)} maxLength={RAG_CONFIG.maxQuestionCharacters} rows={3} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void ask(ragEnabled ? "rag" : "plain"); } }} className={`block w-full resize-y rounded-xl border border-line bg-background p-3 text-sm disabled:opacity-60 ${FOCUS_RING}`} placeholder="Спросите о базе документов Flash Chat…" />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" role="switch" aria-checked={ragEnabled} disabled={Boolean(busy)} onClick={() => setRagEnabled((value) => !value)} className={`${BUTTON} ${ragEnabled ? "border-accent/40 bg-accent/15 text-accent" : "text-muted"}`}>RAG {ragEnabled ? "включён" : "выключен"}</button>
            <button type="submit" disabled={Boolean(busy) || !question.trim() || (ragEnabled && !indexId)} className={`${BUTTON} bg-accent-deep text-white`}>Отправить вопрос</button>
            <button type="button" disabled={Boolean(busy) || !question.trim() || !indexId} onClick={() => void ask("compare")} className={BUTTON}>Сравнить с / без RAG</button>
            {busy && <button type="button" onClick={cancel} className={BUTTON}>Остановить</button>}
          </div>
          <p className="text-xs text-muted">Ctrl+Enter — отправить в выбранном режиме. Переключите RAG и повторите тот же вопрос, чтобы добавить второй ответ рядом.</p>
        </form>
        <div aria-live="polite" className="mt-3 text-sm text-muted">
          {busy === "question" && <p>Агент готовит полный ответ…</p>}
          {busy === "benchmark" && <p>Обработано {progressCases.length} из 10. Каждый вопрос проходит оба режима и оценку; следующий результат появится после завершения.</p>}
          {notice && <p>{notice}</p>}
          {error && <p role="alert" className="text-red-300">{error}</p>}
        </div>
        {answers.length > 0 && <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-2">{answers.map((result) => <RagAnswerCard key={result.mode} result={result} />)}</div>}
      </section>

      <section className={CARD} aria-labelledby="benchmark-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="benchmark-heading" className="text-lg font-semibold">10 контрольных вопросов</h2>
            <p className="mt-2 text-sm text-muted">Одна кнопка запускает 20 ответов и 10 оценок. Ожидания получает только судья. Повторный запуск делает новые запросы к LLM.</p>
          </div>
          <button type="button" disabled={Boolean(busy) || !indexId} onClick={() => void benchmark()} className={`${BUTTON} bg-accent-deep text-white`}>Отправить все 10 вопросов</button>
        </div>
        {displayedCases.length > 0 && <div className="mt-5 rounded-xl border border-line bg-background p-4">
          <p className="text-sm font-medium">{isSavedReport ? `Сохранённый прогон: ${new Date(report!.createdAt).toLocaleString("ru-RU")}` : `Результаты текущего прогона: ${displayedCases.length}/10`}</p>
          {isSavedReport && report!.indexId !== indexId && <p className="mt-2 text-xs text-amber-300">Этот отчёт получен на другой версии индекса. Запустите сравнение заново для текущей базы.</p>}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {(["plain", "rag"] as const).map((mode) => <div key={mode} className="text-sm"><p className="font-medium text-accent">{mode === "rag" ? "С RAG" : "Без RAG"}</p><p className="mt-1 text-muted">Качество {mean(mode, "overall")}/10 · точность {mean(mode, "factualAccuracy")}/10 · полнота {mean(mode, "completeness")}/10</p></div>)}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">Нужный фрагмент найден: {displayedCases.filter((item) => item.retrievalHit).length}/{displayedCases.length}. Оценку даёт та же LLM в роли судьи со случайным порядком A/B; это ориентир для этой базы, а не независимая проверка. Откройте ответы и проверьте ожидания.</p>
        </div>}
        <div className="mt-4 space-y-3">
          {questions.map((item, position) => {
            const result = displayedCases.find((entry) => entry.question.id === item.id);
            const score = result ? scores(result) : null;
            return <details key={item.id} className="min-w-0 rounded-xl border border-line bg-background">
              <summary className={`min-h-11 cursor-pointer break-words rounded-xl p-3 text-sm leading-relaxed ${FOCUS_RING}`}>
                {position + 1}. {item.question}
                {score && <span className="mt-1 block text-xs text-accent">Без RAG {score.plain.overall}/10 · с RAG {score.rag.overall}/10 · {result!.retrievalHit ? "нужный фрагмент найден" : "нужный фрагмент не найден"}</span>}
              </summary>
              <div className="space-y-4 border-t border-line p-3 sm:p-4">
                <div className="text-sm"><p className="font-medium">Ожидание</p><ul className="mt-2 list-disc space-y-1 pl-5 text-muted">{item.expectedFacts.map((fact) => <li key={fact}>{fact}</li>)}</ul></div>
                <p className="break-words text-xs text-muted">Контрольный источник: <code>{item.source}</code> · {item.section}. Цитата для проверки поиска: <code>{item.evidence}</code>.</p>
                <button type="button" disabled={Boolean(busy)} onClick={() => { setQuestion(item.question); textareaRef.current?.focus(); textareaRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }} className={BUTTON}>Подставить вопрос</button>
                {result && <><p className="text-sm text-muted">Оценка судьи: {result.judge.rationale}</p><div className="grid min-w-0 gap-4 lg:grid-cols-2"><RagAnswerCard result={result.plain} /><RagAnswerCard result={result.rag} /></div></>}
              </div>
            </details>;
          })}
        </div>
      </section>
    </div>
  );
}

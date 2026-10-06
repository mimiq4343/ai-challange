"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { RagRefinementAnswerCard } from "@/components/rag-refinement-answer-card";
import { RAG_CONFIG } from "@/lib/rag-config";
import { REFINEMENT_CONFIG, REFINEMENT_LABELS, REFINEMENT_MODES } from "@/lib/rag-refinement-config";
import { REFINEMENT_QUESTIONS } from "@/lib/rag-refinement-questions";
import type { RefinementAnswer, RefinementBenchmarkCase, RefinementBenchmarkReport, RefinementMode, RefinementRequestMode, RefinementSettings } from "@/lib/rag-refinement-types";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const BUTTON = `min-h-11 min-w-11 cursor-pointer rounded-xl border border-line px-4 py-2 text-sm transition-colors hover:border-accent/40 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`;
const CARD = "min-w-0 rounded-2xl border border-line bg-surface p-4 sm:p-6";
const INPUT = `min-h-11 w-full min-w-0 rounded-xl border border-line bg-background px-3 py-2 text-sm text-foreground ${FOCUS_RING}`;

export function RagRefinementWorkspace({ initialReport, indexId, model }: { initialReport: RefinementBenchmarkReport | null; indexId: string | null; model: string | null }) {
  const [question, setQuestion] = useState(REFINEMENT_QUESTIONS[0].question);
  const [mode, setMode] = useState<RefinementMode>("refined");
  const [fields, setFields] = useState({ candidateK: String(REFINEMENT_CONFIG.settings.candidateK), contextK: String(REFINEMENT_CONFIG.settings.contextK), minRelevance: String(REFINEMENT_CONFIG.settings.minRelevance) });
  const [answers, setAnswers] = useState<RefinementAnswer[]>([]);
  const [busy, setBusy] = useState<"question" | "benchmark" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [report, setReport] = useState(initialReport);
  const [progress, setProgress] = useState<RefinementBenchmarkCase[]>([]);
  const requestRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => () => requestRef.current?.abort(), []);

  function settings(): RefinementSettings {
    const values = { candidateK: Number(fields.candidateK), contextK: Number(fields.contextK), minRelevance: Number(fields.minRelevance) };
    if (Object.values(fields).some((value) => !value.trim()) || Object.values(values).some((value) => !Number.isInteger(value)) ||
      values.candidateK < 1 || values.candidateK > REFINEMENT_CONFIG.maxCandidateK || values.contextK < 1 || values.contextK > REFINEMENT_CONFIG.maxContextK || values.contextK > values.candidateK || values.minRelevance < 0 || values.minRelevance > 10) {
      throw new Error(`Top-K до: целое 1–${REFINEMENT_CONFIG.maxCandidateK}; после: 1–${REFINEMENT_CONFIG.maxContextK} и не больше top-K до; порог: целое 0–10.`);
    }
    return values;
  }

  function begin(kind: "question" | "benchmark") {
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(kind);
    setError(null);
    setNotice(null);
    return controller;
  }

  async function ask(selectedMode: RefinementRequestMode) {
    if (busy || !question.trim()) return;
    let selectedSettings;
    try { selectedSettings = settings(); }
    catch (cause) { setError((cause as Error).message); return; }
    const content = question.trim();
    const controller = begin("question");
    setAnswers((current) => current.filter((item) => item.result.question === content && JSON.stringify(item.settings) === JSON.stringify(selectedSettings)));
    try {
      const response = await fetch("/api/rag/refinement", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: content, mode: selectedMode, settings: selectedSettings }), signal: controller.signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Не удалось получить ответ.");
      const expectedModes = selectedMode === "compare" ? REFINEMENT_MODES : [selectedMode];
      if (!Array.isArray(payload.answers) || payload.answers.length !== expectedModes.length || expectedModes.some((expected) => payload.answers.filter((item: RefinementAnswer) => item.mode === expected && item.result.question === content && typeof item.result.answer === "string").length !== 1)) throw new Error("Недействительный ответ агента.");
      if (!controller.signal.aborted) setAnswers((current) => [...current.filter((item) => !expectedModes.includes(item.mode)), ...payload.answers].sort((a, b) => REFINEMENT_MODES.indexOf(a.mode) - REFINEMENT_MODES.indexOf(b.mode)));
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось получить ответ.");
    } finally {
      if (requestRef.current === controller) { requestRef.current = null; setBusy(null); }
    }
  }

  async function benchmark() {
    if (busy) return;
    let selectedSettings;
    try { selectedSettings = settings(); }
    catch (cause) { setError((cause as Error).message); return; }
    const controller = begin("benchmark");
    setProgress([]);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch("/api/rag/refinement/benchmark", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: selectedSettings }), signal: controller.signal });
      if (!response.ok) { const payload = await response.json(); throw new Error(typeof payload.error === "string" ? payload.error : "Сравнение недоступно."); }
      if (!response.body) throw new Error("Нет потока сравнения.");
      reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let buffer = "";
      let complete = false;
      let received = 0;
      const accept = (line: string) => {
        if (!line.trim() || controller.signal.aborted) return;
        const event = JSON.parse(line);
        if (event.type === "error") throw new Error(event.error);
        if (event.type === "case") {
          if (event.position !== received + 1 || event.item?.question?.id !== REFINEMENT_QUESTIONS[received]?.id || !Array.isArray(event.item.answers) || event.item.answers.length !== 3 || !event.item.judge?.scores) throw new Error("Нарушен порядок результатов сравнения.");
          received++;
          setProgress((current) => [...current, event.item]);
        } else if (event.type === "complete") {
          if (received !== REFINEMENT_QUESTIONS.length || event.report?.cases?.length !== received) throw new Error("Сравнение завершилось не полностью.");
          complete = true;
          setReport(event.report);
          setProgress([]);
          setNotice("Все 12 вопросов обработаны. Отчёт сохранён.");
        } else if (event.type !== "start") throw new Error("Неизвестное событие сравнения.");
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
      if (!complete) throw new Error("Поток прервался до завершения. Предыдущий отчёт сохранён.");
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Сравнение не завершено.");
    } finally {
      if (reader) {
        try { await reader.cancel(); } catch { /* Ошибка прерванного потока уже обработана выше. */ }
        finally { reader.releaseLock(); }
      }
      if (controller.signal.aborted) setProgress([]);
      if (requestRef.current === controller) { requestRef.current = null; setBusy(null); }
    }
  }

  function cancel() { requestRef.current?.abort(); setNotice("Запрос остановлен. Предыдущий завершённый отчёт сохранён."); }
  function submit(event: FormEvent) { event.preventDefault(); void ask(mode); }
  const displayed = progress.length > 0 || busy === "benchmark" ? progress : report?.cases ?? [];
  const mean = (selectedMode: RefinementMode, key: "overall" | "factualAccuracy" | "completeness") => displayed.length ? (displayed.reduce((sum, item) => sum + item.judge.scores[selectedMode][key], 0) / displayed.length).toFixed(1) : "—";
  const positiveCases = displayed.filter((item) => item.question.source !== null);
  const negativeCases = displayed.filter((item) => item.question.source === null);
  const currentSettings = displayed[0]?.answers[0].settings ?? report?.settings;

  return (
    <div className="space-y-5">
      <section className={CARD} aria-labelledby="refinement-question-heading">
        <h2 id="refinement-question-heading" className="text-lg font-semibold">Вопрос агенту</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">Сравните исходный поиск, переформулировку запроса и отбор релевантных фрагментов. Ответ строится на исходный вопрос. Модель: {model ?? "не настроена"}.</p>
        {!indexId && <p className="mt-3 text-sm text-amber-300">Индекс отсутствует. Выполните <code>npm run rag:index</code>.</p>}
        <form onSubmit={submit} className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {([{ key: "candidateK", label: "Top-K до обработки", min: 1, max: REFINEMENT_CONFIG.maxCandidateK }, { key: "contextK", label: "Top-K после обработки", min: 1, max: REFINEMENT_CONFIG.maxContextK }, { key: "minRelevance", label: "Порог релевантности, 0–10", min: 0, max: 10 }] as const).map((field) => <label key={field.key} className="min-w-0 space-y-2 text-sm text-muted">
              <span className="block">{field.label}</span><input type="number" required min={field.min} max={field.max} step={1} disabled={Boolean(busy)} value={fields[field.key]} onChange={(event) => setFields((current) => ({ ...current, [field.key]: event.target.value }))} className={INPUT} />
            </label>)}
          </div>
          <p className="text-xs leading-relaxed text-muted">Во всех режимах одинаковый лимит фрагментов для ответа. Порог применяется только в режиме с reranker: оценки ниже порога отсекаются. Это оценка модели, а не вероятность.</p>
          <label className="block space-y-2 text-sm text-muted"><span className="block">Ваш вопрос</span><textarea ref={textareaRef} required disabled={Boolean(busy)} value={question} maxLength={RAG_CONFIG.maxQuestionCharacters} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void ask(mode); } }} rows={3} className={`${INPUT} resize-y`} /></label>
          <div className="flex flex-wrap items-center gap-2">
            <label className="min-w-0 text-sm text-muted"><span className="sr-only">Режим ответа</span><select value={mode} disabled={Boolean(busy)} onChange={(event) => setMode(event.target.value as RefinementMode)} className={INPUT}>{REFINEMENT_MODES.map((item) => <option key={item} value={item}>{REFINEMENT_LABELS[item]}</option>)}</select></label>
            <button type="submit" disabled={Boolean(busy) || !indexId || !question.trim()} className={`${BUTTON} bg-accent-deep text-white`}>Отправить вопрос</button>
            <button type="button" disabled={Boolean(busy) || !indexId || !question.trim()} onClick={() => void ask("compare")} className={BUTTON}>Сравнить три режима</button>
            {busy && <button type="button" onClick={cancel} className={BUTTON}>Остановить</button>}
          </div>
        </form>
        <div className="mt-4 space-y-2 text-sm leading-relaxed" aria-live="polite">
          {busy && <p className="text-muted">{busy === "question" ? "Агент обрабатывает вопрос…" : `Обработано ${progress.length} из 12. Каждый вопрос проходит три режима и слепую оценку.`}</p>}
          {error && <p role="alert" className="text-red-300">{error}</p>}
          {notice && <p className="text-accent">{notice}</p>}
        </div>
      </section>
      {answers.length > 0 && <section aria-label="Ответы в выбранных режимах" className="grid min-w-0 items-start gap-4 xl:grid-cols-3">{answers.map((answer) => <RagRefinementAnswerCard key={answer.mode} answer={answer} />)}</section>}
      <section className={CARD} aria-labelledby="refinement-benchmark-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 id="refinement-benchmark-heading" className="text-lg font-semibold">Сравнение на 12 вопросах</h2><p className="mt-2 text-sm leading-relaxed text-muted">10 вопросов из Дня 22 и 2 вне корпуса. Эталоны доступны только судье; порядок трёх ответов случайный. Судья использует ту же LLM, поэтому оценки ориентировочные.</p></div>
          <button type="button" disabled={Boolean(busy) || !indexId} onClick={() => void benchmark()} className={`${BUTTON} bg-accent-deep text-white`}>Отправить все 12 вопросов</button>
        </div>
        {report && progress.length === 0 && busy !== "benchmark" && <p className="mt-3 text-xs leading-relaxed text-muted">Сохранён {new Date(report.createdAt).toLocaleString("ru-RU")} · {report.model}{report.indexId !== indexId ? " · индекс изменился, результаты относятся к предыдущему снимку" : ""}.</p>}
        {currentSettings && <p className="mt-2 text-xs text-muted">Настройки показанного прогона: top-K {currentSettings.candidateK} / {currentSettings.contextK}, порог {currentSettings.minRelevance}/10.</p>}
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {REFINEMENT_MODES.map((item) => <div key={item} className="min-w-0 rounded-xl border border-line bg-background p-4">
            <h3 className="text-sm font-medium">{REFINEMENT_LABELS[item]}</h3><p className="mt-3 text-2xl font-semibold text-accent">{mean(item, "overall")}<span className="text-sm text-muted"> / 10</span></p>
            <p className="mt-2 text-xs leading-relaxed text-muted">Точность {mean(item, "factualAccuracy")} · полнота {mean(item, "completeness")}.</p>
            <p className="mt-2 text-xs leading-relaxed text-muted">Контрольный фрагмент: {positiveCases.filter((test) => test.retrievalHits[item]).length} / {positiveCases.length || "—"}.</p>
            <p className="mt-2 text-xs leading-relaxed text-muted">Пустой контекст вне корпуса: {negativeCases.filter((test) => test.answers.find((answer) => answer.mode === item)!.result.sources.length === 0).length} / {negativeCases.length || "—"}.</p>
            {displayed.length > 0 && <p className="mt-2 text-xs leading-relaxed text-muted">В среднем {(displayed.reduce((sum, test) => sum + test.answers.find((answer) => answer.mode === item)!.durationMs, 0) / displayed.length / 1000).toFixed(1)} с · {Math.round(displayed.reduce((sum, test) => sum + test.answers.find((answer) => answer.mode === item)!.usage.totalTokens, 0) / displayed.length)} токенов с учётом этапов.</p>}
          </div>)}
        </div>
        {displayed.length > 0 && <p className="mt-3 text-xs leading-relaxed text-muted">Фактически использовано {displayed.reduce((sum, item) => sum + item.usage.totalTokens, 0)} токенов, включая судью. Общий rewrite считается один раз. Время и токены карточек показывают затраты режима при отдельном запуске.</p>}
        <ol className="mt-5 space-y-3">
          {REFINEMENT_QUESTIONS.map((item, index) => {
            const completed = displayed.find((test) => test.question.id === item.id);
            return <li key={item.id} className="min-w-0 rounded-xl border border-line bg-background p-3 sm:p-4">
              <button type="button" disabled={Boolean(busy)} onClick={() => { setQuestion(item.question); textareaRef.current?.focus(); textareaRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }} className={`min-h-11 w-full cursor-pointer text-left text-sm leading-relaxed disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}>{index + 1}. {item.question}{item.source === null && <span className="ml-2 text-xs text-muted">Вне корпуса</span>}</button>
              {completed && <details className="mt-2">
                <summary className={`min-h-11 cursor-pointer rounded-lg py-3 text-xs leading-relaxed text-accent ${FOCUS_RING}`}>Обычный {completed.judge.scores.baseline.overall}/10 · rewrite {completed.judge.scores.rewrite.overall}/10 · reranker {completed.judge.scores.refined.overall}/10 — ответы и оценка</summary>
                <p className="mt-2 text-xs leading-relaxed text-muted">{completed.judge.rationale}</p>
                <div className="mt-4 grid min-w-0 items-start gap-4 xl:grid-cols-3">{completed.answers.map((answer) => <RagRefinementAnswerCard key={answer.mode} answer={answer} />)}</div>
                <details className="mt-3"><summary className={`min-h-11 cursor-pointer py-3 text-xs text-muted ${FOCUS_RING}`}>Ожидаемые факты и контрольный источник</summary><ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted">{item.expectedFacts.map((fact) => <li key={fact}>{fact}</li>)}</ul>{item.source && <p className="mt-2 break-words text-xs text-muted [overflow-wrap:anywhere]">{item.source} · {item.section}</p>}</details>
              </details>}
            </li>;
          })}
        </ol>
      </section>
    </div>
  );
}

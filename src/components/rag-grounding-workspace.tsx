"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { RagRefinementAnswerCard } from "@/components/rag-refinement-answer-card";
import { RAG_CONFIG } from "@/lib/rag-config";
import type { GroundedAnswer, GroundingBenchmarkCase, GroundingBenchmarkReport } from "@/lib/rag-grounding-types";
import { REFINEMENT_CONFIG } from "@/lib/rag-refinement-config";
import { REFINEMENT_QUESTIONS } from "@/lib/rag-refinement-questions";
import type { RefinementSettings } from "@/lib/rag-refinement-types";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const CARD = "min-w-0 rounded-2xl border border-line bg-surface p-4 sm:p-5";
const INPUT = `min-h-11 w-full min-w-0 rounded-xl border border-line bg-background px-3 py-2 text-sm text-foreground disabled:opacity-50 ${FOCUS_RING}`;
const BUTTON = `min-h-11 min-w-11 cursor-pointer rounded-xl border border-line px-4 py-2 text-sm transition-colors hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`;

function AnswerCard({ answer }: { answer: GroundedAnswer }) {
  return <RagRefinementAnswerCard answer={answer} title={answer.status === "unknown" ? "Не знаю — нужно уточнение" : "Ответ по источникам"} quotes={answer.quotes} />;
}

export function RagGroundingWorkspace({ initialReport, indexId, model }: { initialReport: GroundingBenchmarkReport | null; indexId: string | null; model: string | null }) {
  const [question, setQuestion] = useState(REFINEMENT_QUESTIONS[0].question);
  const [fields, setFields] = useState({ candidateK: String(REFINEMENT_CONFIG.settings.candidateK), contextK: String(REFINEMENT_CONFIG.settings.contextK), minRelevance: String(REFINEMENT_CONFIG.settings.minRelevance) });
  const [answer, setAnswer] = useState<GroundedAnswer | null>(null);
  const [report, setReport] = useState(initialReport);
  const [progress, setProgress] = useState<GroundingBenchmarkCase[]>([]);
  const [busy, setBusy] = useState<"question" | "benchmark" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => () => requestRef.current?.abort(), []);

  function settings(): RefinementSettings {
    const values = { candidateK: Number(fields.candidateK), contextK: Number(fields.contextK), minRelevance: Number(fields.minRelevance) };
    if (Object.values(fields).some((value) => !value.trim()) || Object.values(values).some((value) => !Number.isInteger(value)) || values.candidateK < 1 || values.candidateK > REFINEMENT_CONFIG.maxCandidateK || values.contextK < 1 || values.contextK > REFINEMENT_CONFIG.maxContextK || values.contextK > values.candidateK || values.minRelevance < 0 || values.minRelevance > 10) throw new Error(`Кандидаты: 1–${REFINEMENT_CONFIG.maxCandidateK}; контекст: 1–${REFINEMENT_CONFIG.maxContextK} и не больше кандидатов; порог: целое 0–10.`);
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

  async function ask() {
    if (busy || !question.trim()) return;
    let selectedSettings;
    try { selectedSettings = settings(); }
    catch (cause) { setError((cause as Error).message); return; }
    const content = question.trim();
    const controller = begin("question");
    setAnswer(null);
    try {
      const response = await fetch("/api/rag/grounded", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: content, settings: selectedSettings }), signal: controller.signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Не удалось получить ответ.");
      if (payload.answer?.result?.question !== content || !["answered", "unknown"].includes(payload.answer?.status) || !Array.isArray(payload.answer?.quotes) || !Array.isArray(payload.answer?.result?.sources)) throw new Error("Недействительный ответ агента.");
      if (!controller.signal.aborted) setAnswer(payload.answer);
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
      const response = await fetch("/api/rag/grounded/benchmark", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: selectedSettings }), signal: controller.signal });
      if (!response.ok) { const payload = await response.json(); throw new Error(typeof payload.error === "string" ? payload.error : "Проверка недоступна."); }
      if (!response.body) throw new Error("Нет потока проверки.");
      reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let buffer = "";
      let complete = false;
      let received = 0;
      let started = false;
      const accept = (line: string) => {
        if (!line.trim() || controller.signal.aborted) return;
        const event = JSON.parse(line);
        if (complete) throw new Error("Получены данные после завершения проверки.");
        if (event.type === "error") throw new Error(event.error);
        if (event.type === "start") {
          if (started || received || event.total !== REFINEMENT_QUESTIONS.length) throw new Error("Недействительное начало проверки.");
          started = true;
        } else if (event.type === "case") {
          if (!started || event.position !== received + 1 || event.item?.question?.id !== REFINEMENT_QUESTIONS[received]?.id || !event.item?.answer?.result || !event.item?.checks || !event.item?.judge) throw new Error("Нарушен порядок результатов проверки.");
          received++;
          setProgress((current) => [...current, event.item]);
        } else if (event.type === "complete") {
          if (!started || received !== REFINEMENT_QUESTIONS.length || event.report?.cases?.length !== received) throw new Error("Проверка завершилась не полностью.");
          complete = true;
          setReport(event.report);
          setProgress([]);
          setNotice("10 вопросов и 2 проверки отказа завершены. Отчёт сохранён.");
        } else throw new Error("Неизвестное событие проверки.");
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
      if (!complete) throw new Error("Поток прервался до подтверждения сохранения. Показан предыдущий завершённый отчёт.");
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Проверка не завершена.");
    } finally {
      if (reader) {
        try { await reader.cancel(); } catch { /* Ошибка потока уже обработана выше. */ }
        finally { reader.releaseLock(); }
      }
      if (controller.signal.aborted) setProgress([]);
      if (requestRef.current === controller) { requestRef.current = null; setBusy(null); }
    }
  }

  function cancel() { requestRef.current?.abort(); setNotice("Запрос остановлен. Показан предыдущий завершённый отчёт."); }
  function submit(event: FormEvent) { event.preventDefault(); void ask(); }
  const displayed = progress.length > 0 || busy === "benchmark" ? progress : report?.cases ?? [];
  const positive = displayed.filter((item) => item.question.source !== null);
  const answered = positive.filter((item) => item.answer.status === "answered");
  const negative = displayed.filter((item) => item.question.source === null);
  const shownSettings = displayed[0]?.answer.settings ?? report?.settings;

  return <div className="space-y-5">
    <section className={CARD} aria-labelledby="grounding-question-heading">
      <h2 id="grounding-question-heading" className="text-lg font-semibold">Вопрос с подтверждением</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">Ответ содержит источники и дословные цитаты. Если контекст слабый или не подтверждает ответ — «Не знаю» и уточняющий вопрос. Модель: {model ?? "не настроена"}.</p>
      {!indexId && <p className="mt-3 text-sm text-amber-300">Индекс отсутствует. Выполните <code>npm run rag:index</code>.</p>}
      <form onSubmit={submit} className="mt-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {([{ key: "candidateK", label: "Кандидатов для отбора", max: REFINEMENT_CONFIG.maxCandidateK, min: 1 }, { key: "contextK", label: "Фрагментов в контексте", max: REFINEMENT_CONFIG.maxContextK, min: 1 }, { key: "minRelevance", label: "Порог релевантности, 0–10", max: 10, min: 0 }] as const).map((field) => <label key={field.key} className="min-w-0 space-y-2 text-sm text-muted"><span className="block">{field.label}</span><input type="number" required min={field.min} max={field.max} step={1} disabled={Boolean(busy)} value={fields[field.key]} onChange={(event) => setFields((current) => ({ ...current, [field.key]: event.target.value }))} className={INPUT} /></label>)}
        </div>
        <p className="text-xs leading-relaxed text-muted">Фрагменты с оценкой ниже порога отсекаются. Оценка ровно на пороге проходит; это оценка релевантности моделью, а не вероятность.</p>
        <label className="block space-y-2 text-sm text-muted"><span className="block">Ваш вопрос</span><textarea ref={textareaRef} required disabled={Boolean(busy)} value={question} maxLength={RAG_CONFIG.maxQuestionCharacters} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void ask(); } }} rows={3} className={`${INPUT} resize-y`} /></label>
        <div className="flex flex-wrap gap-2"><button type="submit" disabled={Boolean(busy) || !indexId || !question.trim()} className={`${BUTTON} bg-accent-deep text-white`}>Получить ответ с цитатами</button>{busy && <button type="button" onClick={cancel} className={BUTTON}>Остановить</button>}</div>
      </form>
      <div className="mt-4 space-y-2 text-sm leading-relaxed" aria-live="polite">
        {busy && <p className="text-muted">{busy === "question" ? "Поиск источников и подготовка ответа…" : `Проверено ${progress.length} из 12 вопросов.`}</p>}
        {error && <p role="alert" className="text-red-300">{error}</p>}{notice && <p className="text-accent">{notice}</p>}
      </div>
    </section>
    {answer && <section aria-label="Ответ, источники и цитаты"><AnswerCard answer={answer} /></section>}
    <section className={CARD} aria-labelledby="grounding-benchmark-heading">
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 id="grounding-benchmark-heading" className="text-lg font-semibold">Проверка на 10 вопросах</h2><p className="mt-2 text-sm leading-relaxed text-muted">10 вопросов по корпусу и 2 вне корпуса. Проверяем источники, цитаты и смысл. Эталоны видит только судья; он использует ту же LLM, поэтому оценка смысла ориентировочная.</p></div><button type="button" disabled={Boolean(busy) || !indexId} onClick={() => void benchmark()} className={`${BUTTON} bg-accent-deep text-white`}>Проверить все вопросы</button></div>
      {report && !progress.length && busy !== "benchmark" && <p className="mt-3 text-xs leading-relaxed text-muted">Сохранён {new Date(report.createdAt).toLocaleString("ru-RU")} · {report.model}{report.indexId !== indexId ? " · индекс изменился; показан предыдущий снимок" : ""}.</p>}
      {shownSettings && <p className="mt-2 text-xs text-muted">Настройки прогона: кандидаты {shownSettings.candidateK}, контекст {shownSettings.contextK}, порог {shownSettings.minRelevance}/10.</p>}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[{ label: "Источники в ответах по корпусу", value: `${positive.filter((item) => item.checks.hasSources).length} / ${positive.length || "—"}` }, { label: "Цитаты в ответах по корпусу", value: `${positive.filter((item) => item.checks.hasQuotes).length} / ${positive.length || "—"}` }, { label: "Смысл подтверждён цитатами", value: `${answered.filter((item) => item.checks.supported).length} / ${answered.length || "—"}` }, { label: "Корректный отказ вне корпуса", value: `${negative.filter((item) => item.checks.validUnknown && item.checks.supported).length} / ${negative.length || "—"}` }].map((metric) => <div key={metric.label} className="min-w-0 rounded-xl border border-line bg-background p-4"><p className="text-xs leading-relaxed text-muted">{metric.label}</p><p className="mt-3 text-2xl font-semibold text-accent">{metric.value}</p></div>)}
      </div>
      {displayed.length > 0 && <p className="mt-3 text-xs leading-relaxed text-muted">Дословные цитаты: {answered.filter((item) => item.checks.verbatimQuotes).length}/{answered.length} содержательных ответов. Отказы по корпусу: {positive.length - answered.length}/{positive.length}. Контрольный фрагмент: {positive.filter((item) => item.checks.retrievalHit).length}/{positive.length}. Всего {displayed.reduce((sum, item) => sum + item.usage.totalTokens, 0)} токенов, включая проверку смысла.</p>}
      <ol className="mt-5 space-y-3">{REFINEMENT_QUESTIONS.map((item, index) => {
        const completed = displayed.find((test) => test.question.id === item.id);
        return <li key={item.id} className="min-w-0 rounded-xl border border-line bg-background p-3 sm:p-4">
          <button type="button" disabled={Boolean(busy)} onClick={() => { setQuestion(item.question); textareaRef.current?.focus(); textareaRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }} className={`min-h-11 w-full cursor-pointer text-left text-sm leading-relaxed disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}>{index + 1}. {item.question}{item.source === null && <span className="ml-2 text-xs text-muted">Вне корпуса</span>}</button>
          {completed && <details className="mt-2"><summary className={`min-h-11 cursor-pointer rounded-lg py-3 text-xs leading-relaxed text-accent ${FOCUS_RING}`}>{completed.answer.status === "unknown" ? "Не знаю; запрошено уточнение" : `Источники: ${completed.answer.result.sources.length}; цитаты: ${completed.answer.quotes.length}`} · {completed.checks.supported ? "смысл подтверждён" : "есть неподтверждённые утверждения"} — показать ответ</summary><p className="mt-2 text-xs leading-relaxed text-muted">{completed.judge.rationale}</p>{completed.judge.unsupportedClaims.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-300">{completed.judge.unsupportedClaims.map((claim, i) => <li key={i}>{claim}</li>)}</ul>}<div className="mt-4"><AnswerCard answer={completed.answer} /></div><details className="mt-3"><summary className={`min-h-11 cursor-pointer rounded-lg py-3 text-xs text-muted ${FOCUS_RING}`}>Ожидаемые факты и контрольный источник</summary><ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted">{item.expectedFacts.map((fact) => <li key={fact}>{fact}</li>)}</ul>{item.source && <p className="mt-2 break-words text-xs text-muted [overflow-wrap:anywhere]">{item.source} · {item.section}</p>}</details></details>}
        </li>;
      })}</ol>
    </section>
  </div>;
}

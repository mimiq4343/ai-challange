import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { ChatAgent } from "./chat-agent";
import type { CompressionLlmResponder } from "./compression-llm";
import { localDocumentEmbedder } from "./local-document-embeddings";
import { loadRagIndex, RagError, type RagRetrievalDependencies } from "./rag-agent";
import { RAG_CONFIG } from "./rag-config";
import { RAG_EMBEDDING_CONFIG } from "./rag-embedding-config";
import { GroundedRagAgent } from "./rag-grounding-agent";
import { GROUNDING_CONFIG, GROUNDED_ANSWER_PROMPT, GROUNDING_JUDGE_PROMPT } from "./rag-grounding-config";
import type { GroundedAnswer, GroundingBenchmarkCase, GroundingBenchmarkReport, GroundingJudgement } from "./rag-grounding-types";
import { parseGroundedAnswer } from "./rag-grounding-validation";
import { parseRefinementSettings, sumRefinementUsage } from "./rag-refinement-agent";
import { acquireRefinementBenchmarkLock } from "./rag-refinement-benchmark";
import { QUERY_REWRITE_PROMPT, RELEVANCE_RERANK_PROMPT } from "./rag-refinement-config";
import { REFINEMENT_QUESTIONS } from "./rag-refinement-questions";
import type { RefinementQuestion, RefinementSettings } from "./rag-refinement-types";
import { assertContextFits, countChatPrompt } from "./token-counter";

type BenchmarkOptions = RagRetrievalDependencies & {
  llm: CompressionLlmResponder;
  settings: RefinementSettings;
  signal: AbortSignal;
  questions?: readonly RefinementQuestion[];
  onCase?: (item: GroundingBenchmarkCase, position: number) => void;
};

function structuralChecks(answer: GroundedAnswer) {
  const hasSources = answer.result.sources.length > 0;
  const hasQuotes = answer.quotes.length > 0;
  const verbatimQuotes = hasQuotes && answer.quotes.every((quote) => answer.result.sources.some((source) => source.id === quote.sourceId && source.chunkId === quote.chunkId && source.text.includes(quote.text)));
  const validUnknown = answer.status === "unknown" && /не знаю/i.test(answer.result.answer) && Boolean(answer.clarification?.trim()) && !hasSources && !hasQuotes;
  return { hasSources, hasQuotes, verbatimQuotes, validUnknown };
}

async function judgeGrounding(llm: CompressionLlmResponder, question: RefinementQuestion, answer: GroundedAnswer, signal: AbortSignal): Promise<GroundingJudgement> {
  const request = JSON.stringify({ question: question.question, reference: { expectedFacts: question.expectedFacts, source: question.source, section: question.section, evidence: question.evidence },
    answer: { status: answer.status, answer: answer.result.answer, clarification: answer.clarification, quotes: answer.quotes,
      sources: answer.result.sources.map(({ id, source, section, chunkId, text }) => ({ id, source, section, chunkId, text })) } });
  const judgeSignal = AbortSignal.any([signal, AbortSignal.timeout(RAG_CONFIG.requestTimeoutMs)]);
  assertContextFits(await countChatPrompt({ systemMessages: [GROUNDING_JUDGE_PROMPT], history: [], request, reservedOutputTokens: RAG_CONFIG.maxOutputTokens }));
  judgeSignal.throwIfAborted();
  const response = await llm.respond([{ role: "user", content: request }], judgeSignal, { systemMessages: [GROUNDING_JUDGE_PROMPT], strictStream: true, maxOutputTokens: RAG_CONFIG.maxOutputTokens });
  const text = await new Response(response.stream).text();
  judgeSignal.throwIfAborted();
  const usage = await response.usage;
  if (await response.finishReason !== "stop" || !usage || text.length > RAG_CONFIG.maxAnswerCharacters) throw new RagError("Проверка смысла не завершена или не содержит статистику токенов.", 502);
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 3 || typeof value.supported !== "boolean" ||
      typeof value.rationale !== "string" || !value.rationale.trim() || value.rationale.length > 2_000 || !Array.isArray(value.unsupportedClaims) || value.unsupportedClaims.length > 20 ||
      value.unsupportedClaims.some((claim: unknown) => typeof claim !== "string" || !claim.trim() || claim.length > 2_000) || value.supported !== (value.unsupportedClaims.length === 0)) throw new TypeError("Недействительная оценка смысла.");
    return { supported: value.supported, rationale: value.rationale.trim(), unsupportedClaims: value.unsupportedClaims, usage };
  } catch (cause) { throw new RagError("Судья вернул недействительную оценку соответствия цитатам.", 502, { cause }); }
}

export async function runGroundingBenchmark(options: BenchmarkOptions): Promise<GroundingBenchmarkReport> {
  const { llm, index, embedder, signal } = options;
  const settings = parseRefinementSettings(options.settings);
  const questions = options.questions ?? REFINEMENT_QUESTIONS;
  if (!index.report || !index.chunks.length || index.report.model !== RAG_EMBEDDING_CONFIG.model || index.report.dimensions !== RAG_EMBEDDING_CONFIG.dimensions) throw new RagError("Нужен совместимый локальный индекс для проверки цитат.", 503);
  if (questions.length !== 12 || new Set(questions.map((item) => item.id)).size !== 12 || questions.filter((item) => item.source === null).length !== 2 || questions.some((item) =>
    !item.id.trim() || !item.question.trim() || !item.expectedFacts.length || item.expectedFacts.some((fact) => !fact.trim()) ||
    (item.source === null ? item.section !== null || item.evidence !== null : !item.section || !item.evidence || !index.chunks.some((chunk) => chunk.source === item.source && chunk.section.includes(item.section!) && chunk.text.includes(item.evidence!))))) throw new RagError("Нужны 10 подтверждённых индексом вопросов и 2 вопроса вне корпуса с уникальными ID.", 503);
  const agent = new GroundedRagAgent(llm, { index, embedder });
  const cases: GroundingBenchmarkCase[] = [];
  for (const question of questions) {
    signal.throwIfAborted();
    const answer = await agent.respond(question.question, settings, signal);
    const judge = await judgeGrounding(llm, question, answer, signal);
    const checks = { ...structuralChecks(answer), supported: judge.supported,
      retrievalHit: question.source === null ? null : answer.result.sources.some((source) => source.source === question.source && source.text.includes(question.evidence!)) };
    const item = { question, answer, checks, judge, usage: sumRefinementUsage([answer.usage, judge.usage]) };
    cases.push(item);
    options.onCase?.(item, cases.length);
  }
  signal.throwIfAborted();
  return { version: 1, createdAt: new Date().toISOString(), model: llm.model, indexId: index.report.id, corpusHash: index.report.corpus.hash,
    embeddingModel: index.report.model, settings, prompts: { rewrite: QUERY_REWRITE_PROMPT, rerank: RELEVANCE_RERANK_PROMPT, answer: GROUNDED_ANSWER_PROMPT, judge: GROUNDING_JUDGE_PROMPT }, cases };
}

export function configuredGroundingBenchmark(settings: RefinementSettings, signal: AbortSignal, onCase?: BenchmarkOptions["onCase"]) {
  return runGroundingBenchmark({ llm: ChatAgent.fromEnvironment(), index: loadRagIndex(), embedder: localDocumentEmbedder, settings, signal, onCase });
}

function validateReport(report: GroundingBenchmarkReport): void {
  if (report.version !== 1 || !report.indexId || !report.model || !report.corpusHash || !report.embeddingModel || !report.prompts || !Array.isArray(report.cases) || report.cases.length !== 12 ||
    new Set(report.cases.map((item) => item.question.id)).size !== 12 || report.cases.filter((item) => item.question.source === null).length !== 2) throw new Error("Отчёт проверки цитат неполон или повреждён.");
  const settings = parseRefinementSettings(report.settings);
  for (const item of report.cases) {
    const answer = item.answer;
    if (answer.result.indexId !== report.indexId || answer.result.model !== report.model || answer.result.question !== item.question.question || answer.mode !== "refined" ||
      JSON.stringify(parseRefinementSettings(answer.settings)) !== JSON.stringify(settings) || answer.result.invalidCitations.length || item.judge.supported !== item.checks.supported || item.judge.supported !== (item.judge.unsupportedClaims.length === 0)) throw new Error("Ответ или оценка не соответствует отчёту.");
    const context = answer.candidates.filter((candidate) => candidate.decision === "selected")
      .sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0) || b.source.score - a.source.score || a.source.chunkId.localeCompare(b.source.chunkId)).map(({ source }, index) => ({ ...source, id: `S${index + 1}` }));
    const parsed = parseGroundedAnswer(JSON.stringify({ status: answer.status, answer: answer.result.answer, clarification: answer.clarification,
      sources: answer.result.sources.map(({ id, source, section, chunkId }) => ({ id, source, section, chunkId })), quotes: answer.quotes.map(({ sourceId, text }) => ({ sourceId, text })) }), context);
    if (parsed.sources.some((source, index) => source.text !== answer.result.sources[index].text) || parsed.quotes.some((quote, index) => quote.chunkId !== answer.quotes[index].chunkId) || JSON.stringify(parsed.citations) !== JSON.stringify(answer.result.citations)) throw new Error("Текст источника, ID цитаты или список ссылок изменён.");
    const checks = structuralChecks(answer);
    if (Object.entries(checks).some(([key, value]) => item.checks[key as keyof typeof checks] !== value)) throw new Error("Структурные метрики отчёта не соответствуют ответу.");
  }
}

export async function saveGroundingBenchmark(report: GroundingBenchmarkReport, path: string = GROUNDING_CONFIG.reportPath, signal?: AbortSignal): Promise<void> {
  validateReport(report);
  signal?.throwIfAborted();
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  let previous: Buffer | null;
  try { previous = await readFile(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; previous = null; }
  let committed = false;
  try {
    await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
    signal?.throwIfAborted();
    await rename(temporary, path);
    committed = true;
    signal?.throwIfAborted();
  } catch (cause) {
    try {
      if (committed) {
        if (previous === null) await rm(path, { force: true });
        else {
          await writeFile(temporary, previous, { flag: "wx" });
          await rename(temporary, path);
        }
      }
      await rm(temporary, { force: true });
    } catch (recoveryError) {
      throw new AggregateError([cause, recoveryError], "Не удалось восстановить предыдущий отчёт после ошибки сохранения.");
    }
    throw cause;
  }
}

export async function readGroundingBenchmark(path: string = GROUNDING_CONFIG.reportPath): Promise<GroundingBenchmarkReport | null> {
  let text;
  try { text = await readFile(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  const report = JSON.parse(text) as GroundingBenchmarkReport;
  validateReport(report);
  return report;
}

export function acquireGroundingBenchmarkLock(path: string = GROUNDING_CONFIG.lockPath) {
  return acquireRefinementBenchmarkLock(path);
}

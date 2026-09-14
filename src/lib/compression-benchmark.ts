import "server-only";

import { randomInt } from "node:crypto";
import { parseBlindJudgeResult } from "./blind-judge";
import { ChatAgent, ChatAgentError, CHAT_SYSTEM_PROMPT, type ChatMessage } from "./chat-agent";
import {
  consumeRequiredProviderResponse,
  type CompressionLlmResponder,
} from "./compression-llm";
import {
  getCompressionRunStore,
  type SqliteCompressionRunStore,
} from "./compression-run-store";
import type {
  CompressionRun,
  BenchmarkCallMetrics,
} from "./compression-types";
import type { ChatRequestOptions } from "./conversation-types";
import {
  buildSummaryRequest,
  buildSummarySystemMessage,
  SUMMARY_MAX_OUTPUT_TOKENS,
  SUMMARY_SYSTEM_PROMPT,
} from "./history-compression";
import { assertContextFits, countChatPrompt } from "./token-counter";

export const BENCHMARK_HISTORY = [
  { role: "user", content: "Кодовое имя проекта — Аврора." },
  { role: "assistant", content: "Запомнил кодовое имя: Аврора." },
  { role: "user", content: "Дата запуска — 15 мая." },
  { role: "assistant", content: "Запомнил дату запуска: 15 мая." },
  { role: "user", content: "Основной склад находится в Казани." },
  { role: "assistant", content: "Запомнил склад: Казань." },
  { role: "user", content: "Бюджет пилота — 2,4 млн рублей." },
  { role: "assistant", content: "Запомнил бюджет: 2,4 млн рублей." },
  { role: "user", content: "Руководитель проекта — Марина Волкова." },
  { role: "assistant", content: "Запомнил руководителя: Марина Волкова." },
  { role: "user", content: "Доставка выполняется железной дорогой." },
  { role: "assistant", content: "Запомнил способ доставки: железная дорога." },
  { role: "user", content: "Поставщик упаковки — Орион." },
  { role: "assistant", content: "Запомнил поставщика: Орион." },
  { role: "user", content: "Пилотная партия содержит 320 единиц." },
  { role: "assistant", content: "Запомнил объём: 320 единиц." },
  { role: "user", content: "Цвет маркировки — синий." },
  { role: "assistant", content: "Запомнил цвет маркировки: синий." },
  { role: "user", content: "Отчётность ведётся в рублях." },
  { role: "assistant", content: "Запомнил валюту отчётности: рубли." },
] as const satisfies readonly ChatMessage[];

export const BENCHMARK_QUESTION = `Верни только одну JSON-строку без Markdown. Ключи: project, launchDate, warehouse, budget, lead, delivery, supplier, pilotUnits, labelColor, currency.`;

const BENCHMARK_REFERENCE = {
  project: "Аврора",
  launchDate: "15 мая",
  warehouse: "Казань",
  budget: "2,4 млн рублей",
  lead: "Марина Волкова",
  delivery: "железная дорога",
  supplier: "Орион",
  pilotUnits: 320,
  labelColor: "синий",
  currency: "рубли",
} as const;

const JUDGE_SYSTEM_PROMPT = `Ты слепой судья двух ответов A и B.
Оцени каждый ответ целыми числами 0–10. Верни ровно один JSON object: первый символ {, последний }.
Не используй Markdown и не добавляй другие ключи. Точная схема:
{"a":{"factualAccuracy":0,"completeness":0,"instructionFollowing":0,"overall":0},"b":{"factualAccuracy":0,"completeness":0,"instructionFollowing":0,"overall":0},"winner":"a","rationale":"Краткое объяснение"}
winner может быть только "a", "b" или "tie".`;

type CompletedCall = {
  text: string;
  metrics: BenchmarkCallMetrics;
};

export class CompressionBenchmark {
  constructor(
    private readonly llm: CompressionLlmResponder,
    private readonly store: SqliteCompressionRunStore,
    private readonly randomBit: () => 0 | 1 = () => randomInt(0, 2) as 0 | 1,
    private readonly now: () => Date = () => new Date(),
  ) {}

  static fromEnvironment(): CompressionBenchmark {
    return new CompressionBenchmark(
      ChatAgent.fromEnvironment(),
      getCompressionRunStore(),
    );
  }

  private async execute(
    history: readonly ChatMessage[],
    request: string,
    signal: AbortSignal,
    options?: ChatRequestOptions,
  ): Promise<CompletedCall> {
    const preflight = await countChatPrompt({
      systemMessages: options?.systemMessages,
      history,
      request,
      reservedOutputTokens: options?.maxOutputTokens,
    });
    assertContextFits(preflight);
    const response = await this.llm.respond(
      [...history, { role: "user", content: request }],
      signal,
      options,
    );
    const completed = await consumeRequiredProviderResponse(response, this.now);
    return { text: completed.text, metrics: completed.metrics };
  }

  async run(signal: AbortSignal): Promise<CompressionRun> {
    const firstTen = BENCHMARK_HISTORY.slice(0, 10);
    const lastTen = BENCHMARK_HISTORY.slice(10);
    const summary = await this.execute(
      [],
      buildSummaryRequest(null, firstTen),
      signal,
      {
        systemMessages: [SUMMARY_SYSTEM_PROMPT],
        maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
      },
    );
    const full = await this.execute(BENCHMARK_HISTORY, BENCHMARK_QUESTION, signal);
    const compressed = await this.execute(
      lastTen,
      BENCHMARK_QUESTION,
      signal,
      {
        systemMessages: [
          CHAT_SYSTEM_PROMPT,
          buildSummarySystemMessage(summary.text),
        ],
      },
    );

    const labelA = this.randomBit() === 0 ? "full" : "compressed";
    const answerA = labelA === "full" ? full.text : compressed.text;
    const answerB = labelA === "full" ? compressed.text : full.text;
    const judgeRequest = JSON.stringify({
      reference: BENCHMARK_REFERENCE,
      question: BENCHMARK_QUESTION,
      rubric: [
        "Фактическая точность относительно reference",
        "Полнота всех десяти полей",
        "Соблюдение формата одной JSON-строки",
      ],
      answerA,
      answerB,
    });
    const judgeCall = await this.execute([], judgeRequest, signal, {
      systemMessages: [JUDGE_SYSTEM_PROMPT],
      maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
    });

    let judge;
    try {
      judge = parseBlindJudgeResult(judgeCall.text);
    } catch (error) {
      throw new ChatAgentError("Judge вернул недействительный JSON.", "upstream", {
        cause: error,
      });
    }
    const grossSavedTokens =
      full.metrics.promptTokens - compressed.metrics.promptTokens;
    const summaryOverheadTokens =
      summary.metrics.promptTokens + summary.metrics.completionTokens;

    return this.store.saveRun({
      model: this.llm.model,
      summary: summary.text,
      fullAnswer: full.text,
      compressedAnswer: compressed.text,
      labelA,
      judge,
      calls: {
        summary: summary.metrics,
        full: full.metrics,
        compressed: compressed.metrics,
        judge: judgeCall.metrics,
      },
      grossSavedTokens,
      summaryOverheadTokens,
      netSavedTokens: grossSavedTokens - summaryOverheadTokens,
    });
  }
}

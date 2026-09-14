import "server-only";

import { ChatAgent, CHAT_SYSTEM_PROMPT, type ChatMessage } from "./chat-agent";
import { consumeRequiredProviderResponse, type CompressionLlmResponder } from "./compression-llm";
import {
  buildFactsSystemMessage,
  buildFactsUpdateRequest,
  EMPTY_STICKY_FACTS,
  FACTS_EXTRACTOR_SYSTEM_PROMPT,
  FACTS_MAX_OUTPUT_TOKENS,
  parseStickyFacts,
  takeSlidingWindow,
} from "./context-strategy-policy";
import {
  getContextStrategyStore,
  type SqliteContextStrategyStore,
} from "./context-strategy-store";
import type {
  BenchmarkStrategyResult,
  ContextBenchmarkRun,
  ContextStrategy,
  StickyFacts,
} from "./context-strategy-types";

export const CONTEXT_BENCHMARK_SCENARIO: readonly ChatMessage[] = [
  { role: "user", content: "Цель: запустить систему Аврора для планирования закупок." },
  { role: "assistant", content: "Зафиксировал цель проекта Аврора." },
  { role: "user", content: "Бюджет — 1 800 000 рублей." },
  { role: "assistant", content: "Бюджет зафиксирован." },
  { role: "user", content: "Срок запуска — 15 ноября." },
  { role: "assistant", content: "Срок принят." },
  { role: "user", content: "Платформа — web, аудитория — руководители отделов." },
  { role: "assistant", content: "Платформу и аудиторию записал." },
  { role: "user", content: "Ограничение: не хранить персональные данные." },
  { role: "assistant", content: "Ограничение принято." },
  { role: "user", content: "Решение: PostgreSQL. Предпочтение: тёмная тема." },
  { role: "assistant", content: "Решение и предпочтение зафиксированы." },
];

export const CONTEXT_BENCHMARK_QUESTION =
  "Собери итоговое ТЗ: цель, бюджет, срок, платформа, аудитория, ограничение, решение и предпочтение.";

const REQUIRED_FACTS = [
  { label: "Аврора", variants: ["аврора"] },
  { label: "1 800 000 рублей", variants: ["1800000", "1,8млн", "1.8млн"] },
  { label: "15 ноября", variants: ["15ноября"] },
  { label: "web", variants: ["web", "веб"] },
  { label: "руководители отделов", variants: ["руководителиотделов"] },
  { label: "без персональных данных", variants: ["нехранитьперсональныеданные", "безперсональныхданных"] },
  { label: "PostgreSQL", variants: ["postgresql"] },
  { label: "тёмная тема", variants: ["тёмнаятема", "темнаятема"] },
] as const;

const EARLY_FACTS: Record<string, true> = {
  Аврора: true,
  "1 800 000 рублей": true,
  "15 ноября": true,
};

function normalize(value: string): string {
  return value.toLocaleLowerCase("ru-RU").replace(/[^a-zа-яё0-9]/gu, "");
}

function scoreAnswer(answer: string): Pick<
  BenchmarkStrategyResult,
  "qualityScore" | "stabilityScore" | "retainedFacts" | "missingFacts"
> {
  const normalized = normalize(answer);
  const retainedFacts = REQUIRED_FACTS.filter(({ variants }) =>
    variants.some((variant) => normalized.includes(normalize(variant))),
  ).map(({ label }) => label);
  const missingFacts = REQUIRED_FACTS
    .map(({ label }) => label)
    .filter((label) => !retainedFacts.includes(label));
  const retainedEarly = retainedFacts.filter((label) => Object.hasOwn(EARLY_FACTS, label)).length;
  return {
    qualityScore: Math.round((retainedFacts.length / REQUIRED_FACTS.length) * 10),
    stabilityScore: Math.round((retainedEarly / Object.keys(EARLY_FACTS).length) * 10),
    retainedFacts,
    missingFacts,
  };
}

function usability(strategy: ContextStrategy): string {
  if (strategy === "sliding") return "Просто и дёшево, но ранние детали исчезают.";
  if (strategy === "facts") return "Ключевые данные стабильны, но обновление facts добавляет LLM-вызов.";
  return "Максимальный контроль альтернатив, но пользователь управляет checkpoint и ветками.";
}

export class ContextStrategyBenchmark {
  constructor(
    private readonly llm: CompressionLlmResponder,
    private readonly store: SqliteContextStrategyStore,
  ) {}

  static fromEnvironment(
    store: SqliteContextStrategyStore = getContextStrategyStore(),
  ): ContextStrategyBenchmark {
    return new ContextStrategyBenchmark(ChatAgent.fromEnvironment(), store);
  }

  private async finalCall(
    strategy: ContextStrategy,
    history: readonly ChatMessage[],
    systemMessages: readonly string[],
    overheadTokens: number,
    overheadCostMicrosUsd: number,
    signal: AbortSignal,
  ): Promise<BenchmarkStrategyResult> {
    const response = await this.llm.respond(
      [...history, { role: "user", content: CONTEXT_BENCHMARK_QUESTION }],
      signal,
      { systemMessages },
    );
    const completed = await consumeRequiredProviderResponse(response);
    return {
      strategy,
      answer: completed.text,
      promptTokens: completed.usage.promptTokens,
      completionTokens: completed.usage.completionTokens,
      overheadTokens,
      costMicrosUsd: completed.metrics.costMicrosUsd + overheadCostMicrosUsd,
      ...scoreAnswer(completed.text),
      usability: usability(strategy),
    };
  }

  async run(signal: AbortSignal): Promise<ContextBenchmarkRun> {
    const sliding = await this.finalCall(
      "sliding",
      takeSlidingWindow(CONTEXT_BENCHMARK_SCENARIO),
      [CHAT_SYSTEM_PROMPT],
      0,
      0,
      signal,
    );

    let facts: StickyFacts = EMPTY_STICKY_FACTS;
    let factsOverheadTokens = 0;
    let factsOverheadCost = 0;
    for (const message of CONTEXT_BENCHMARK_SCENARIO) {
      if (message.role !== "user") continue;
      const response = await this.llm.respond(
        [{ role: "user", content: buildFactsUpdateRequest(facts, message.content) }],
        signal,
        {
          systemMessages: [FACTS_EXTRACTOR_SYSTEM_PROMPT],
          maxOutputTokens: FACTS_MAX_OUTPUT_TOKENS,
        },
      );
      const completed = await consumeRequiredProviderResponse(response);
      facts = parseStickyFacts(completed.text);
      factsOverheadTokens += completed.usage.totalTokens;
      factsOverheadCost += completed.metrics.costMicrosUsd;
    }
    const factsResult = await this.finalCall(
      "facts",
      takeSlidingWindow(CONTEXT_BENCHMARK_SCENARIO),
      [CHAT_SYSTEM_PROMPT, buildFactsSystemMessage(facts)],
      factsOverheadTokens,
      factsOverheadCost,
      signal,
    );

    const checkpointPrefix = CONTEXT_BENCHMARK_SCENARIO.slice(0, 8);
    const branchA = CONTEXT_BENCHMARK_SCENARIO.slice(8);
    const branching = await this.finalCall(
      "branching",
      [...checkpointPrefix, ...branchA],
      [CHAT_SYSTEM_PROMPT],
      0,
      0,
      signal,
    );

    return this.store.saveBenchmarkRun({
      model: this.llm.model,
      results: [sliding, factsResult, branching],
    });
  }
}

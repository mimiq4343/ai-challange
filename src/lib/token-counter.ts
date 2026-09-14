import "server-only";

import path from "node:path";
import { AutoTokenizer, env, type PreTrainedTokenizer } from "@huggingface/transformers";

import { CHAT_SYSTEM_PROMPT, type ChatMessage } from "./chat-agent";
import type { TokenBreakdown } from "./conversation-types";
import {
  DEEPSEEK_FLASH_PROFILE,
  NEMOTRON_OVERFLOW_PROFILE,
} from "./model-profiles";

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = path.join(process.cwd(), "tokenizers");

type LoadedTokenizer = PreTrainedTokenizer;

const tokenizerPromises = new Map<string, Promise<LoadedTokenizer>>();

function getTokenizer(name: string): Promise<LoadedTokenizer> {
  const existing = tokenizerPromises.get(name);
  if (existing) return existing;

  const loading = AutoTokenizer.from_pretrained(name, { local_files_only: true });
  tokenizerPromises.set(name, loading);
  return loading;
}

function assertTokenIds(value: unknown): asserts value is number[] {
  if (
    !Array.isArray(value) ||
    !value.every((token) => Number.isSafeInteger(token) && token >= 0)
  ) {
    throw new TypeError("Tokenizer вернул недействительный список token IDs.");
  }
}

async function countTemplatedMessages(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  addGenerationPrompt: boolean,
): Promise<number> {
  const tokenizer = await getTokenizer(DEEPSEEK_FLASH_PROFILE.tokenizer);
  const tokenIds = tokenizer.apply_chat_template(messages, {
    tokenize: true,
    add_generation_prompt: addGenerationPrompt,
    return_tensor: false,
    return_dict: false,
  });
  assertTokenIds(tokenIds);
  return tokenIds.length;
}

export async function countTextTokens(
  text: string,
  tokenizerName: string = DEEPSEEK_FLASH_PROFILE.tokenizer,
): Promise<number> {
  const tokenizer = await getTokenizer(tokenizerName);
  return tokenizer.encode(text, { add_special_tokens: false }).length;
}

export async function countChatPrompt(input: {
  systemPrompt?: string;
  history: ChatMessage[];
  request: string;
  contextLimit?: number;
  reservedOutputTokens?: number;
}): Promise<TokenBreakdown> {
  const systemPrompt = input.systemPrompt ?? CHAT_SYSTEM_PROMPT;
  const contextLimit = input.contextLimit ?? DEEPSEEK_FLASH_PROFILE.contextWindow;
  const reservedOutputTokens =
    input.reservedOutputTokens ?? DEEPSEEK_FLASH_PROFILE.responseReserveTokens;
  const systemMessages = [{ role: "system" as const, content: systemPrompt }];
  const historyMessages = [...systemMessages, ...input.history];
  const fullMessages = [
    ...historyMessages,
    { role: "user" as const, content: input.request },
  ];

  const [systemTokens, systemAndHistoryTokens, promptTokens] = await Promise.all([
    countTemplatedMessages(systemMessages, false),
    countTemplatedMessages(historyMessages, false),
    countTemplatedMessages(fullMessages, true),
  ]);
  const historyTokens = systemAndHistoryTokens - systemTokens;
  const requestTokens = promptTokens - systemAndHistoryTokens;

  if (historyTokens < 0 || requestTokens < 0) {
    throw new Error("Chat template нарушил монотонность token prefixes.");
  }

  return {
    systemTokens,
    historyTokens,
    requestTokens,
    promptTokens,
    reservedOutputTokens,
    contextTokens: promptTokens + reservedOutputTokens,
    contextLimit,
  };
}

export class ContextLimitError extends Error {
  readonly status = 422;

  constructor(readonly breakdown: TokenBreakdown) {
    super(
      `Контекст превышен на ${breakdown.contextTokens - breakdown.contextLimit} токенов.`,
    );
    this.name = "ContextLimitError";
  }
}

export function assertContextFits(breakdown: TokenBreakdown): void {
  if (breakdown.contextTokens > breakdown.contextLimit) {
    throw new ContextLimitError(breakdown);
  }
}

const OVERFLOW_SENTENCE =
  "Retrieval systems preserve exact context boundaries for every measured request.";

function repeatedOverflowText(repetitions: number): string {
  return Array.from({ length: repetitions }, () => OVERFLOW_SENTENCE).join(" ");
}

export async function buildOverflowInput(
  targetTokens = NEMOTRON_OVERFLOW_PROFILE.targetInputTokens,
): Promise<{ text: string; tokens: number }> {
  if (!Number.isSafeInteger(targetTokens) || targetTokens <= 0) {
    throw new TypeError("targetTokens должен быть положительным целым числом.");
  }

  let lower = 1;
  let upper = 1;
  while (
    (await countTextTokens(
      repeatedOverflowText(upper),
      NEMOTRON_OVERFLOW_PROFILE.tokenizer,
    )) < targetTokens
  ) {
    lower = upper + 1;
    upper *= 2;
  }

  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    const tokens = await countTextTokens(
      repeatedOverflowText(middle),
      NEMOTRON_OVERFLOW_PROFILE.tokenizer,
    );
    if (tokens < targetTokens) lower = middle + 1;
    else upper = middle;
  }

  const text = repeatedOverflowText(lower);
  const tokens = await countTextTokens(text, NEMOTRON_OVERFLOW_PROFILE.tokenizer);
  if (tokens < targetTokens || tokens > targetTokens + 64) {
    throw new Error(`Не удалось собрать overflow input: получено ${tokens} токенов.`);
  }

  return { text, tokens };
}

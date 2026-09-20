import "server-only";

import { CHAT_SYSTEM_PROMPT, type ChatMessage } from "./chat-agent";
import type { StoredMessage } from "./conversation-types";
import { DEEPSEEK_FLASH_PROFILE } from "./model-profiles";
import type {
  LongTermEntry,
  LongTermKind,
  MemoryLayerTokens,
  MemoryLayerToggles,
  WorkingMemory,
  WorkingSlot,
  WorkingSlotKind,
} from "./memory-types";
import { countTemplatedMessages, countTextTokens } from "./token-counter";

/** Окно краткосрочной памяти: сколько последних сообщений уходит дословно. */
export const SHORT_TERM_WINDOW_MESSAGES = 8;
export const LONG_TERM_TOKEN_BUDGET = 2_000;
export const WORKING_TOKEN_BUDGET = 1_000;

const LONG_TERM_LABELS: Record<LongTermKind, string> = {
  profile: "профиль",
  decision: "решение",
  knowledge: "знание",
};

const WORKING_LABELS: Record<WorkingSlotKind, string> = {
  fact: "факт",
  constraint: "ограничение",
  step: "шаг",
  open_question: "открытый вопрос",
};

const LONG_TERM_HEADER =
  "Долговременная память агента. Используй эти сведения как известные факты и не переспрашивай их:";
const WORKING_HEADER = "Рабочая память — состояние текущей задачи:";
export type ComposedMemoryPrompt = {
  systemMessages: string[];
  longTermBlock: string | null;
  workingBlock: string | null;
  history: ChatMessage[];
  includedLongTerm: LongTermEntry[];
  skippedLongTerm: LongTermEntry[];
  includedSlots: WorkingSlot[];
  skippedSlots: WorkingSlot[];
  shortTermMessages: number;
  totalMessages: number;
};

async function selectWithinBudget<T>(
  items: readonly T[],
  budget: number,
  render: (item: T) => string,
): Promise<{ included: T[]; skipped: T[] }> {
  const included: T[] = [];
  const skipped: T[] = [];
  let used = 0;

  for (const item of items) {
    const tokens = await countTextTokens(render(item));
    if (used + tokens > budget) {
      skipped.push(item);
      continue;
    }
    used += tokens;
    included.push(item);
  }

  return { included, skipped };
}

export async function composeMemoryPrompt(input: {
  messages: readonly StoredMessage[];
  longTerm: readonly LongTermEntry[];
  working: WorkingMemory | null;
  layers: MemoryLayerToggles;
}): Promise<ComposedMemoryPrompt> {
  const longTermSelection = input.layers.longTerm
    ? await selectWithinBudget(
        input.longTerm,
        LONG_TERM_TOKEN_BUDGET,
        (entry) => `- [${LONG_TERM_LABELS[entry.kind]}] ${entry.key}: ${entry.value}\n`,
      )
    : { included: [], skipped: [...input.longTerm] };

  const longTermBlock =
    longTermSelection.included.length > 0
      ? `${LONG_TERM_HEADER}\n${longTermSelection.included
          .map((entry) => `- [${LONG_TERM_LABELS[entry.kind]}] ${entry.key}: ${entry.value}`)
          .join("\n")}`
      : null;

  const workingSlots = input.working?.slots ?? [];
  const workingSelection =
    input.layers.working && input.working
      ? await selectWithinBudget(
          workingSlots,
          WORKING_TOKEN_BUDGET,
          (slot) => `- [${WORKING_LABELS[slot.kind]}] ${slot.value}\n`,
        )
      : { included: [], skipped: [...workingSlots] };

  let workingBlock: string | null = null;
  if (input.layers.working && input.working) {
    const { task } = input.working;
    workingBlock = [
      WORKING_HEADER,
      `Задача: ${task.title}`,
      ...(task.goal ? [`Цель: ${task.goal}`] : []),
      ...workingSelection.included.map(
        (slot) => `- [${WORKING_LABELS[slot.kind]}] ${slot.value}`,
      ),
    ].join("\n");
  }

  const window = input.layers.shortTerm
    ? input.messages.slice(-SHORT_TERM_WINDOW_MESSAGES)
    : [];

  return {
    systemMessages: [CHAT_SYSTEM_PROMPT, longTermBlock, workingBlock].filter(
      (block): block is string => block !== null,
    ),
    longTermBlock,
    workingBlock,
    history: window.map(({ role, content }) => ({ role, content })),
    includedLongTerm: longTermSelection.included,
    skippedLongTerm: longTermSelection.skipped,
    includedSlots: workingSelection.included,
    skippedSlots: workingSelection.skipped,
    shortTermMessages: window.length,
    totalMessages: input.messages.length,
  };
}

/**
 * Считает вклад каждого слоя префиксными разностями chat template: слой стоит
 * ровно столько, на сколько он удлиняет промпт в своей позиции.
 */
export async function countMemoryPromptTokens(input: {
  composed: ComposedMemoryPrompt;
  request: string;
  contextLimit?: number;
  reservedOutputTokens?: number;
}): Promise<MemoryLayerTokens> {
  const contextLimit = input.contextLimit ?? DEEPSEEK_FLASH_PROFILE.contextWindow;
  const reservedOutputTokens =
    input.reservedOutputTokens ?? DEEPSEEK_FLASH_PROFILE.responseReserveTokens;
  const { longTermBlock, workingBlock } = input.composed;
  const base = input.composed.systemMessages[0];
  const withLongTerm = longTermBlock ? [base, longTermBlock] : [base];
  const withWorking = workingBlock ? [...withLongTerm, workingBlock] : withLongTerm;

  const toSystem = (contents: readonly string[]) =>
    contents.map((content) => ({ role: "system" as const, content }));

  const [systemTokens, longTermPrefix, workingPrefix, historyPrefix, promptTokens] =
    await Promise.all([
      countTemplatedMessages(toSystem([base]), false),
      countTemplatedMessages(toSystem(withLongTerm), false),
      countTemplatedMessages(toSystem(withWorking), false),
      countTemplatedMessages([...toSystem(withWorking), ...input.composed.history], false),
      countTemplatedMessages(
        [
          ...toSystem(withWorking),
          ...input.composed.history,
          { role: "user" as const, content: input.request },
        ],
        true,
      ),
    ]);

  const longTermTokens = longTermPrefix - systemTokens;
  const workingTokens = workingPrefix - longTermPrefix;
  const shortTermTokens = historyPrefix - workingPrefix;
  const requestTokens = promptTokens - historyPrefix;

  if (
    longTermTokens < 0 ||
    workingTokens < 0 ||
    shortTermTokens < 0 ||
    requestTokens < 0
  ) {
    throw new Error("Chat template нарушил монотонность token prefixes.");
  }

  return {
    systemTokens,
    longTermTokens,
    workingTokens,
    shortTermTokens,
    requestTokens,
    promptTokens,
    reservedOutputTokens,
    contextTokens: promptTokens + reservedOutputTokens,
    contextLimit,
  };
}

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
import { INVARIANT_CATEGORY_LABELS, type Invariant } from "./invariant-types";
import { TASK_STAGE_LABELS } from "./task-machine";
import type { TaskSnapshot } from "./task-types";
import {
  PROFILE_EXPERTISES,
  PROFILE_FORMATS,
  PROFILE_LANGUAGES,
  PROFILE_TONES,
  PROFILE_VERBOSITIES,
  type UserProfile,
} from "./profile-types";
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
const TASK_HEADER = "Состояние задачи";
const INVARIANT_HEADER = "Инварианты проекта, нарушать запрещено:";

/** Свод правил идёт первым блоком: он сильнее любых других слоёв. */
export function renderInvariantBlock(invariants: readonly Invariant[]): string {
  const lines = invariants.map(
    (invariant) =>
      `- [${INVARIANT_CATEGORY_LABELS[invariant.category]}] ${invariant.statement}${
        invariant.rationale ? ` Почему: ${invariant.rationale}` : ""
      }`,
  );

  return [
    INVARIANT_HEADER,
    ...lines,
    "Решение, нарушающее инвариант, предлагать нельзя даже как вариант. Если запрос требует нарушения, откажись, процитируй правило и предложи альтернативу в рамках.",
  ].join("\n");
}

/**
 * Правила поведения для дня с конечным автоматом: без них состояние задачи
 * остаётся справкой, а агент отвечает одним большим сообщением.
 */
export const TASK_STEPWISE_RULES = `Ты ведёшь работу по конечному автомату задачи и обязан держаться его состояния.
На этапе планирования, если плана ещё нет, первым делом выдай нумерованный список из 3–7 шагов, по одной короткой строке на шаг, и только после списка задай уточняющие вопросы. Сами шаги на этом этапе не выполняй и не расписывай их содержимое.
Если план уже есть, не переписывай его: назови текущий шаг и спроси подтверждение перехода к выполнению.
На этапе выполнения работай ровно над текущим шагом, не забегая в следующие, и заканчивай ответ тем, что сделано и что требуется дальше.
На этапе проверки предъяви результат к приёмке и перечисли, что осталось проверить.
Если задача на паузе, отвечай на вопрос, но не продвигай работу дальше текущего шага.
Согласованный план не пересказывай заново: он уже сохранён в состоянии.`;

/** Собирает блок конечного автомата: этап, шаг и ожидаемое действие. */
export function renderTaskBlock(snapshot: TaskSnapshot): string {
  const { run, steps } = snapshot;
  const done = steps.filter((step) => step.status === "done");
  const remaining = steps.filter(
    (step) => step.status === "pending" || step.status === "active",
  );
  const current = steps.find((step) => step.id === run.currentStepId) ?? remaining[0];
  const lines = [
    `${TASK_HEADER} «${run.title}»: этап ${TASK_STAGE_LABELS[run.stage]}, ${
      run.paused ? "на паузе" : "пауза снята"
    }.`,
  ];
  if (run.goal) lines.push(`Цель: ${run.goal}.`);
  if (current) {
    lines.push(`Шаг ${current.position} из ${steps.length}: «${current.title}».`);
  } else if (run.stage === "planning") {
    lines.push("Плана ещё нет: сначала предложи нумерованный список шагов.");
  }
  if (done.length > 0) {
    lines.push(
      `Выполнено: ${done.map((step) => `${step.position}) ${step.title}`).join("; ")}.`,
    );
  }
  const pending = remaining.filter((step) => step.id !== current?.id);
  if (pending.length > 0) {
    lines.push(
      `Осталось: ${pending.map((step) => `${step.position}) ${step.title}`).join("; ")}.`,
    );
  }
  if (run.blockedReason) lines.push(`Причина блокировки: ${run.blockedReason}.`);
  lines.push(
    `Ожидается: ${run.expectedActor === "agent" ? "агент" : "пользователь"} — ${run.expectedAction}.`,
  );
  lines.push("План и решения уже согласованы — не переспрашивай их заново.");

  return lines.join("\n");
}

/** Собирает блок персонализации из профиля пользователя. */
export function renderProfileBlock(profile: UserProfile): string {
  const title = profile.role
    ? `Профиль пользователя: ${profile.name} (${profile.role})`
    : `Профиль пользователя: ${profile.name}`;
  const style = [
    `Отвечай ${PROFILE_VERBOSITIES[profile.verbosity]}`,
    `тон — ${PROFILE_TONES[profile.tone]}`,
    `формат — ${PROFILE_FORMATS[profile.format]}`,
    `язык — ${PROFILE_LANGUAGES[profile.language]}`,
    `уровень собеседника — ${PROFILE_EXPERTISES[profile.expertise]}`,
  ].join(", ");
  const lines = [title, `${style}.`];
  if (profile.constraints.length > 0) {
    lines.push(
      `Ограничения: ${profile.constraints.map((constraint) => constraint.value).join("; ")}.`,
    );
  }

  return lines.join("\n");
}

export type ComposedMemoryPrompt = {
  systemMessages: string[];
  invariantBlock: string | null;
  profileBlock: string | null;
  taskBlock: string | null;
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
  invariants?: readonly Invariant[];
  profile: UserProfile | null;
  task?: TaskSnapshot | null;
  longTerm: readonly LongTermEntry[];
  working: WorkingMemory | null;
  layers: MemoryLayerToggles;
}): Promise<ComposedMemoryPrompt> {
  const invariantBlock =
    input.layers.invariants && input.invariants && input.invariants.length > 0
      ? renderInvariantBlock(input.invariants)
      : null;
  const profileBlock =
    input.layers.profile && input.profile ? renderProfileBlock(input.profile) : null;
  const taskBlock = input.layers.task && input.task ? renderTaskBlock(input.task) : null;

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
    systemMessages: [
      taskBlock ? `${CHAT_SYSTEM_PROMPT}\n\n${TASK_STEPWISE_RULES}` : CHAT_SYSTEM_PROMPT,
      invariantBlock,
      profileBlock,
      taskBlock,
      longTermBlock,
      workingBlock,
    ].filter((block): block is string => block !== null),
    invariantBlock,
    profileBlock,
    taskBlock,
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
  const { invariantBlock, profileBlock, taskBlock, longTermBlock, workingBlock } =
    input.composed;
  const base = input.composed.systemMessages[0];
  const withInvariants = invariantBlock ? [base, invariantBlock] : [base];
  const withProfile = profileBlock ? [...withInvariants, profileBlock] : withInvariants;
  const withTask = taskBlock ? [...withProfile, taskBlock] : withProfile;
  const withLongTerm = longTermBlock ? [...withTask, longTermBlock] : withTask;
  const withWorking = workingBlock ? [...withLongTerm, workingBlock] : withLongTerm;

  const toSystem = (contents: readonly string[]) =>
    contents.map((content) => ({ role: "system" as const, content }));

  const [
    systemTokens,
    invariantPrefix,
    profilePrefix,
    taskPrefix,
    longTermPrefix,
    workingPrefix,
    historyPrefix,
    promptTokens,
  ] = await Promise.all([
    countTemplatedMessages(toSystem([base]), false),
    countTemplatedMessages(toSystem(withInvariants), false),
    countTemplatedMessages(toSystem(withProfile), false),
    countTemplatedMessages(toSystem(withTask), false),
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

  const invariantTokens = invariantPrefix - systemTokens;
  const profileTokens = profilePrefix - invariantPrefix;
  const taskTokens = taskPrefix - profilePrefix;
  const longTermTokens = longTermPrefix - taskPrefix;
  const workingTokens = workingPrefix - longTermPrefix;
  const shortTermTokens = historyPrefix - workingPrefix;
  const requestTokens = promptTokens - historyPrefix;

  if (
    invariantTokens < 0 ||
    profileTokens < 0 ||
    taskTokens < 0 ||
    longTermTokens < 0 ||
    workingTokens < 0 ||
    shortTermTokens < 0 ||
    requestTokens < 0
  ) {
    throw new Error("Chat template нарушил монотонность token prefixes.");
  }

  return {
    systemTokens,
    invariantTokens,
    profileTokens,
    taskTokens,
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

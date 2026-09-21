import type { MemoryRouterLlm } from "./memory-router-llm";
import { FEATURES } from "./feature-flags";
import {
  isPreferenceValue,
  PROFILE_FIELD_VALUES,
  type UserProfile,
} from "./profile-types";
import { isTaskStage, TASK_STAGE_LABELS } from "./task-machine";
import type { TaskSnapshot, TaskStateUpdate } from "./task-types";
import type {
  LongTermKind,
  MemoryRouterResult,
  MemoryRouterWrite,
  WorkingMemory,
  WorkingSlotKind,
} from "./memory-types";
import { calculateDeepSeekCost } from "./token-cost";

const MAX_WRITES = 6;
const MAX_STEPS = 8;
const MAX_KEY_LENGTH = 64;
const MAX_VALUE_LENGTH = 400;
const MAX_TITLE_LENGTH = 80;
const MAX_EXCERPT_LENGTH = 2_000;
/** Контракт роутера вырос до трёх слоёв и плана задачи: 512 токенов обрезали JSON. */
const ROUTER_OUTPUT_TOKENS = 1_024;

const LONG_TERM_KINDS: Record<LongTermKind, true> = {
  profile: true,
  decision: true,
  knowledge: true,
};

const WORKING_KINDS: Record<WorkingSlotKind, true> = {
  fact: true,
  constraint: true,
  step: true,
  open_question: true,
};

const PROFILE_RULES = `
- profile — то, КАК пользователь просит с ним разговаривать. Допустимые значения: tone = neutral|friendly|formal|direct; verbosity = brief|balanced|detailed; format = prose|bullets|table|code_first; language = ru|en|auto; expertise = beginner|intermediate|expert; role — свободный текст о роли пользователя; constraint — свободный запрет или требование к ответам.
- «Отвечай короче» — это verbosity = brief, «давай сразу код» — format = code_first, «без эмодзи» — constraint.`;

const TASK_RULES = `
- taskState описывает конечный автомат задачи. transition — один из planning|execution|validation|done|blocked|cancelled или null, если этап не меняется.
- Разрешены только переходы planning→execution, execution→validation, validation→done, validation→execution, любой рабочий этап→blocked или cancelled, blocked→прежний этап.
- newSteps заполняй только на этапе planning: это план задачи по шагам.
- completedSteps — номера шагов, которые в этом обмене действительно выполнены.
- block — причина блокировки, если продолжать нельзя без внешнего действия; иначе null.
- expectedActor = agent|user и expectedAction — кто и что делает дальше.`;

/**
 * Системный промпт роутера собирается по включённым возможностям: выключенная
 * персонализация не должна подсказывать модели слой профиля.
 */
export function buildMemoryRouterSystemPrompt(options: {
  personalization: boolean;
  task: boolean;
}): string {
  const writeShapes = [
    `{"layer": "long_term", "kind": "profile|decision|knowledge", "key": "snake_case", "value": "строка", "reason": "строка"}`,
    `{"layer": "working", "kind": "fact|constraint|step|open_question", "value": "строка", "reason": "строка"}`,
    ...(options.personalization
      ? [
          `{"layer": "profile", "kind": "tone|verbosity|format|language|expertise|role|constraint", "value": "строка", "reason": "строка"}`,
        ]
      : []),
  ].join(", ");
  const taskShape = options.task
    ? `, "taskState": {"transition": "planning|execution|validation|done|blocked|cancelled или null", "completedSteps": [1], "newSteps": ["строка"], "expectedActor": "agent|user", "expectedAction": "строка", "block": "строка или null"}`
    : "";

  return `Ты маршрутизатор памяти агента и не общаешься с пользователем.
Разбери последний обмен и реши, что сохранить в память. Ответ — только JSON:
{"task": {"title": "строка", "goal": "строка или null"} | null, "closeTask": false, "writes": [${writeShapes}]${taskShape}}

Правила маршрутизации:
- long_term — устойчивые сведения о пользователе, принятые решения и знания, полезные в других диалогах, а также всё, что пользователь явно просил запомнить. profile — про пользователя, decision — принятое решение, knowledge — проверенный факт предметной области.
- working — данные текущей задачи: её факты, ограничения, шаги и открытые вопросы.${
    options.personalization ? PROFILE_RULES : ""
  }${options.task ? TASK_RULES : ""}
- Дословный диалог уже сохранён отдельно: не пересказывай реплики, приветствия и формулировки ответа.
- task заполняй, только когда в обмене видна цель работы; иначе null.
- closeTask = true только если пользователь явно объявил задачу завершённой.
- key — короткий латинский идентификатор в snake_case, стабильный между обменами.
- reason — одна короткая фраза по-русски.
- Если сохранять нечего, верни "writes": [].
- Не больше ${MAX_WRITES} записей.`;
}

export class MemoryRouterError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MemoryRouterError";
  }
}

export function buildMemoryRouterPrompt(input: {
  request: string;
  response: string;
  working: WorkingMemory | null;
  longTermKeys: readonly string[];
  profile: UserProfile | null;
  task?: TaskSnapshot | null;
}): string {
  const task = input.working
    ? `${input.working.task.title}${input.working.task.goal ? ` — ${input.working.task.goal}` : ""}`
    : "нет активной задачи";
  const slots =
    input.working && input.working.slots.length > 0
      ? input.working.slots.map((slot) => `${slot.kind}: ${slot.value}`).join("; ")
      : "нет слотов";
  const profile = input.profile
    ? `${input.profile.name}: tone=${input.profile.tone}, verbosity=${input.profile.verbosity}, format=${input.profile.format}, language=${input.profile.language}, expertise=${input.profile.expertise}, role=${input.profile.role ?? "не задана"}, ограничения=${
        input.profile.constraints.length > 0
          ? input.profile.constraints.map((constraint) => constraint.value).join("; ")
          : "нет"
      }`
    : "профиль не подключён";
  const taskLine = input.task
    ? `«${input.task.run.title}», этап ${TASK_STAGE_LABELS[input.task.run.stage]}${
        input.task.run.paused ? " (на паузе)" : ""
      }, шаги: ${
        input.task.steps.length > 0
          ? input.task.steps
              .map((step) => `${step.position}) ${step.title} — ${step.status}`)
              .join("; ")
          : "плана ещё нет"
      }`
    : "задача не заведена";

  return [
    `Известные ключи долговременной памяти: ${
      input.longTermKeys.length > 0 ? input.longTermKeys.join(", ") : "нет"
    }`,
    `Текущая задача: ${task}`,
    `Слоты рабочей памяти: ${slots}`,
    ...(input.profile ? [`Текущий профиль: ${profile}`] : []),
    `Состояние задачи: ${taskLine}`,
    `Сообщение пользователя: ${input.request.slice(0, MAX_EXCERPT_LENGTH)}`,
    `Ответ агента: ${input.response.slice(0, MAX_EXCERPT_LENGTH)}`,
  ].join("\n");
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new MemoryRouterError("Ответ роутера памяти не содержит JSON-объект.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch (error) {
    throw new MemoryRouterError("Ответ роутера памяти не является валидным JSON.", {
      cause: error,
    });
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new MemoryRouterError("Ответ роутера памяти не является JSON-объектом.");
  }

  return parsed as Record<string, unknown>;
}

function normalizeText(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > limit ? trimmed.slice(0, limit) : trimmed;
}

function parseWrite(value: unknown): MemoryRouterWrite | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const text = normalizeText(candidate.value, MAX_VALUE_LENGTH);
  if (!text) return null;
  const reason = normalizeText(candidate.reason, MAX_VALUE_LENGTH);

  if (candidate.layer === "long_term") {
    const kind = candidate.kind;
    const key = normalizeText(candidate.key, MAX_KEY_LENGTH);
    if (typeof kind !== "string" || !(kind in LONG_TERM_KINDS) || !key) return null;
    return { layer: "long_term", kind: kind as LongTermKind, key, value: text, reason };
  }

  if (candidate.layer === "working") {
    const kind = candidate.kind;
    if (typeof kind !== "string" || !(kind in WORKING_KINDS)) return null;
    return { layer: "working", kind: kind as WorkingSlotKind, value: text, reason };
  }

  if (candidate.layer === "profile") {
    const kind = candidate.kind;
    if (typeof kind !== "string") return null;
    if (kind === "constraint" || kind === "role") {
      return { layer: "profile", kind, value: text, reason };
    }
    if (!(kind in PROFILE_FIELD_VALUES)) return null;
    const field = kind as keyof typeof PROFILE_FIELD_VALUES;
    if (!isPreferenceValue(field, text)) return null;
    return { layer: "profile", kind: field, value: text, reason };
  }

  return null;
}

/**
 * Разбирает ответ роутера. Отдельная невалидная запись отбрасывается, а
 * полностью нечитаемый ответ считается ошибкой и не пишет в память ничего.
 */
function parseTaskState(value: unknown): TaskStateUpdate | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const transition = isTaskStage(candidate.transition) ? candidate.transition : null;
  const completedSteps = Array.isArray(candidate.completedSteps)
    ? candidate.completedSteps.filter(
        (position): position is number =>
          Number.isSafeInteger(position) && (position as number) > 0,
      )
    : [];
  const newSteps = Array.isArray(candidate.newSteps)
    ? candidate.newSteps
        .map((title) => normalizeText(title, MAX_VALUE_LENGTH))
        .filter((title): title is string => title !== null)
        .slice(0, MAX_STEPS)
    : [];
  const expectedActor =
    candidate.expectedActor === "agent" || candidate.expectedActor === "user"
      ? candidate.expectedActor
      : null;
  const expectedAction = normalizeText(candidate.expectedAction, MAX_VALUE_LENGTH);
  const block = normalizeText(candidate.block, MAX_VALUE_LENGTH);

  if (
    !transition &&
    completedSteps.length === 0 &&
    newSteps.length === 0 &&
    !expectedAction &&
    !block
  ) {
    return null;
  }

  return { transition, completedSteps, newSteps, expectedActor, expectedAction, block };
}

export function parseMemoryRouterResponse(raw: string): Omit<MemoryRouterResult, "cost"> {
  const parsed = parseJsonObject(raw);
  const rawWrites = Array.isArray(parsed.writes) ? parsed.writes : [];
  const writes = rawWrites
    .map(parseWrite)
    .filter((write): write is MemoryRouterWrite => write !== null)
    .slice(0, MAX_WRITES);

  let task: MemoryRouterResult["task"] = null;
  if (typeof parsed.task === "object" && parsed.task !== null) {
    const candidate = parsed.task as Record<string, unknown>;
    const title = normalizeText(candidate.title, MAX_TITLE_LENGTH);
    if (title) task = { title, goal: normalizeText(candidate.goal, MAX_VALUE_LENGTH) };
  }

  return {
    task,
    closeTask: parsed.closeTask === true,
    writes,
    taskState: parseTaskState(parsed.taskState),
  };
}

export async function runMemoryRouter(input: {
  llm: MemoryRouterLlm;
  request: string;
  response: string;
  working: WorkingMemory | null;
  longTermKeys: readonly string[];
  profile: UserProfile | null;
  task?: TaskSnapshot | null;
}): Promise<MemoryRouterResult> {
  const completion = await input.llm.complete({
    systemPrompt: buildMemoryRouterSystemPrompt({
      personalization: FEATURES.personalization && input.profile !== null,
      task: Boolean(input.task),
    }),
    userPrompt: buildMemoryRouterPrompt(input),
    maxOutputTokens: ROUTER_OUTPUT_TOKENS,
  });
  const parsed = parseMemoryRouterResponse(completion.content);
  const usage = completion.usage;

  return {
    ...parsed,
    cost: usage
      ? {
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          costMicrosUsd: calculateDeepSeekCost({
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            cacheHitTokens: usage.cacheHitTokens,
            cacheMissTokens: usage.cacheMissTokens,
            at: new Date(),
          }).costMicrosUsd,
        }
      : null,
  };
}

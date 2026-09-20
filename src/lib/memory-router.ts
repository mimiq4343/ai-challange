import type { MemoryRouterLlm } from "./memory-router-llm";
import type {
  LongTermKind,
  MemoryRouterResult,
  MemoryRouterWrite,
  WorkingMemory,
  WorkingSlotKind,
} from "./memory-types";
import { calculateDeepSeekCost } from "./token-cost";

const MAX_WRITES = 5;
const MAX_KEY_LENGTH = 64;
const MAX_VALUE_LENGTH = 400;
const MAX_TITLE_LENGTH = 80;
const MAX_EXCERPT_LENGTH = 2_000;
const ROUTER_OUTPUT_TOKENS = 512;

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

export const MEMORY_ROUTER_SYSTEM_PROMPT = `Ты маршрутизатор памяти агента и не общаешься с пользователем.
Разбери последний обмен и реши, что сохранить в память. Ответ — только JSON:
{"task": {"title": "строка", "goal": "строка или null"} | null, "closeTask": false, "writes": [{"layer": "long_term", "kind": "profile|decision|knowledge", "key": "snake_case", "value": "строка", "reason": "строка"}, {"layer": "working", "kind": "fact|constraint|step|open_question", "value": "строка", "reason": "строка"}]}

Правила маршрутизации:
- long_term — устойчивые сведения о пользователе, принятые решения и знания, полезные в других диалогах, а также всё, что пользователь явно просил запомнить. profile — про пользователя, decision — принятое решение, knowledge — проверенный факт предметной области.
- working — данные текущей задачи: её факты, ограничения, шаги и открытые вопросы.
- Дословный диалог уже сохранён отдельно: не пересказывай реплики, приветствия и формулировки ответа.
- task заполняй, только когда в обмене видна цель работы; иначе null.
- closeTask = true только если пользователь явно объявил задачу завершённой.
- key — короткий латинский идентификатор в snake_case, стабильный между обменами.
- reason — одна короткая фраза по-русски.
- Если сохранять нечего, верни "writes": [].
- Не больше ${MAX_WRITES} записей.`;

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
}): string {
  const task = input.working
    ? `${input.working.task.title}${input.working.task.goal ? ` — ${input.working.task.goal}` : ""}`
    : "нет активной задачи";
  const slots =
    input.working && input.working.slots.length > 0
      ? input.working.slots.map((slot) => `${slot.kind}: ${slot.value}`).join("; ")
      : "нет слотов";

  return [
    `Известные ключи долговременной памяти: ${
      input.longTermKeys.length > 0 ? input.longTermKeys.join(", ") : "нет"
    }`,
    `Текущая задача: ${task}`,
    `Слоты рабочей памяти: ${slots}`,
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

  return null;
}

/**
 * Разбирает ответ роутера. Отдельная невалидная запись отбрасывается, а
 * полностью нечитаемый ответ считается ошибкой и не пишет в память ничего.
 */
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

  return { task, closeTask: parsed.closeTask === true, writes };
}

export async function runMemoryRouter(input: {
  llm: MemoryRouterLlm;
  request: string;
  response: string;
  working: WorkingMemory | null;
  longTermKeys: readonly string[];
}): Promise<MemoryRouterResult> {
  const completion = await input.llm.complete({
    systemPrompt: MEMORY_ROUTER_SYSTEM_PROMPT,
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

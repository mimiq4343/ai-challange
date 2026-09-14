import type { ChatMessage } from "./chat-agent";
import type { StickyFacts } from "./context-strategy-types";

export const WINDOW_MESSAGES = 6;
export const FACTS_MAX_OUTPUT_TOKENS = 512;

export const EMPTY_STICKY_FACTS: StickyFacts = {
  goal: "",
  constraints: [],
  preferences: [],
  decisions: [],
  agreements: [],
};

const FACT_KEYS = [
  "goal",
  "constraints",
  "preferences",
  "decisions",
  "agreements",
] as const;

export const FACTS_EXTRACTOR_SYSTEM_PROMPT = `Ты обновляешь key-value memory диалога.
Верни ровно один JSON object без Markdown и дополнительных ключей:
{"goal":"","constraints":[],"preferences":[],"decisions":[],"agreements":[]}
Сохраняй актуальную цель, ограничения, предпочтения, решения и договорённости.
Не додумывай факты. Новая информация заменяет противоречащую старую.
Все элементы массивов и goal должны быть строками.`;

function stringArray(value: unknown, key: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    !value.every((item) => typeof item === "string" && item.length <= 1_000)
  ) {
    throw new TypeError(`facts.${key} должен быть массивом строк.`);
  }
  return value;
}

export function parseStickyFacts(text: string): StickyFacts {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new TypeError("Facts extractor должен вернуть только JSON object.");
  }

  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch (error) {
    throw new TypeError("Facts extractor вернул недействительный JSON.", { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Facts extractor должен вернуть JSON object.");
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== FACT_KEYS.length ||
    FACT_KEYS.some((key) => !Object.hasOwn(record, key))
  ) {
    throw new TypeError("Facts extractor вернул неверный набор ключей.");
  }
  if (typeof record.goal !== "string" || record.goal.length > 1_000) {
    throw new TypeError("facts.goal должен быть строкой.");
  }

  return {
    goal: record.goal,
    constraints: stringArray(record.constraints, "constraints"),
    preferences: stringArray(record.preferences, "preferences"),
    decisions: stringArray(record.decisions, "decisions"),
    agreements: stringArray(record.agreements, "agreements"),
  };
}

export function buildFactsUpdateRequest(
  previous: StickyFacts,
  userMessage: string,
): string {
  return `Текущие facts:\n${JSON.stringify(previous)}\n\nНовое сообщение пользователя:\n${userMessage}`;
}

export function buildFactsSystemMessage(facts: StickyFacts): string {
  return `Sticky Facts — достоверная key-value memory диалога:\n${JSON.stringify(facts)}`;
}

export function takeSlidingWindow(
  messages: readonly ChatMessage[],
): ChatMessage[] {
  return messages.slice(-WINDOW_MESSAGES);
}

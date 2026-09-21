import type { GuardVerdict, Invariant } from "./invariant-types";
import { INVARIANT_CATEGORY_LABELS } from "./invariant-types";
import type { MemoryRouterLlm } from "./memory-router-llm";

const GUARD_OUTPUT_TOKENS = 512;
const MAX_REQUEST_LENGTH = 2_000;
const MAX_TEXT_LENGTH = 600;

export const INVARIANT_GUARD_SYSTEM_PROMPT = `Ты проверяешь запрос пользователя на конфликт с инвариантами проекта и не отвечаешь на сам запрос.
Инвариант — правило, которое нарушать нельзя: архитектура, принятое техническое решение, ограничение по стеку или бизнес-правило.
Ответ — только JSON: {"verdict": "allow" | "conflict", "invariantIds": [1], "explanation": "строка", "alternative": "строка или null"}

Правила:
- conflict ставь, только если выполнение запроса требует нарушить инвариант: применить запрещённую технологию, отменить принятое решение, обойти бизнес-правило.
- Вопрос о самом инварианте, просьба объяснить его или обсудить последствия — это allow.
- invariantIds — идентификаторы нарушенных правил из списка, без выдуманных номеров.
- explanation — одна-две фразы по-русски: что именно в запросе нарушает правило.
- alternative — что можно сделать вместо этого, не нарушая инвариант; если альтернативы нет, верни null.
- Сомневаешься — verdict = allow.`;

export function renderInvariantList(invariants: readonly Invariant[]): string {
  return invariants
    .map(
      (invariant) =>
        `#${invariant.id} [${INVARIANT_CATEGORY_LABELS[invariant.category]}] ${invariant.statement}${
          invariant.rationale ? ` (почему: ${invariant.rationale})` : ""
        }`,
    )
    .join("\n");
}

export function buildInvariantGuardPrompt(input: {
  request: string;
  invariants: readonly Invariant[];
}): string {
  return [
    "Инварианты проекта:",
    renderInvariantList(input.invariants),
    "",
    `Запрос пользователя: ${input.request.slice(0, MAX_REQUEST_LENGTH)}`,
  ].join("\n");
}

function normalize(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > limit ? trimmed.slice(0, limit) : trimmed;
}

/**
 * Разбирает вердикт проверки. Нечитаемый ответ трактуется как `allow`: сбой
 * страховки не должен превращаться в отказ обслуживания.
 */
export function parseGuardVerdict(
  raw: string,
  knownIds: readonly number[],
): GuardVerdict {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return { verdict: "allow" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return { verdict: "allow" };
  }
  if (typeof parsed !== "object" || parsed === null) return { verdict: "allow" };

  const candidate = parsed as Record<string, unknown>;
  if (candidate.verdict !== "conflict") return { verdict: "allow" };

  const invariantIds = Array.isArray(candidate.invariantIds)
    ? candidate.invariantIds.filter(
        (id): id is number => typeof id === "number" && knownIds.includes(id),
      )
    : [];
  const explanation = normalize(candidate.explanation, MAX_TEXT_LENGTH);
  if (invariantIds.length === 0 || !explanation) return { verdict: "allow" };

  return {
    verdict: "conflict",
    invariantIds,
    explanation,
    alternative: normalize(candidate.alternative, MAX_TEXT_LENGTH),
  };
}

export async function checkInvariants(input: {
  llm: MemoryRouterLlm;
  request: string;
  invariants: readonly Invariant[];
}): Promise<GuardVerdict> {
  if (input.invariants.length === 0) return { verdict: "allow" };

  const completion = await input.llm.complete({
    systemPrompt: INVARIANT_GUARD_SYSTEM_PROMPT,
    userPrompt: buildInvariantGuardPrompt(input),
    maxOutputTokens: GUARD_OUTPUT_TOKENS,
  });
  return parseGuardVerdict(
    completion.content,
    input.invariants.map((invariant) => invariant.id),
  );
}

/** Текст отказа: цитата правила, причина и путь в рамках. */
export function renderRefusal(
  verdict: Extract<GuardVerdict, { verdict: "conflict" }>,
  invariants: readonly Invariant[],
): string {
  const violated = invariants.filter((invariant) =>
    verdict.invariantIds.includes(invariant.id),
  );
  const lines = [
    "Не могу предложить такое решение: запрос нарушает инвариант проекта.",
    "",
    ...violated.map(
      (invariant) =>
        `> [${INVARIANT_CATEGORY_LABELS[invariant.category]}] ${invariant.statement}${
          invariant.rationale ? `\n> Почему: ${invariant.rationale}` : ""
        }`,
    ),
    "",
    `В чём конфликт: ${verdict.explanation}`,
  ];
  if (verdict.alternative) {
    lines.push("", `Что можно сделать вместо этого: ${verdict.alternative}`);
  }
  lines.push(
    "",
    "Если правило устарело, снимите или измените его в панели инвариантов — в диалоге оно не отменяется.",
  );

  return lines.join("\n");
}

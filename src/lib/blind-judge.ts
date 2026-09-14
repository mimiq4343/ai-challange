import type { BlindJudgeResult, JudgeScores } from "./compression-types";

const SCORE_KEYS = [
  "factualAccuracy",
  "completeness",
  "instructionFollowing",
  "overall",
] as const;
const TOP_LEVEL_KEYS = ["a", "b", "winner", "rationale"] as const;


function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function parseScores(value: unknown): JudgeScores {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Judge scores имеют недействительную структуру.");
  }
  const scores = value as Record<string, unknown>;
  if (!hasExactKeys(scores, SCORE_KEYS)) {
    throw new TypeError("Judge scores имеют недействительную структуру.");
  }
  for (const key of SCORE_KEYS) {
    const score = scores[key];
    if (!Number.isInteger(score) || (score as number) < 0 || (score as number) > 10) {
      throw new TypeError(`Judge score ${key} должен быть целым числом от 0 до 10.`);
    }
  }
  return scores as JudgeScores;
}

export function parseBlindJudgeResult(text: string): BlindJudgeResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new TypeError("Judge должен вернуть один JSON object.", { cause: error });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Judge result имеет недействительную структуру.");
  }
  const result = value as Record<string, unknown>;
  if (!hasExactKeys(result, TOP_LEVEL_KEYS)) {
    throw new TypeError("Judge result имеет недействительную структуру.");
  }
  if (result.winner !== "a" && result.winner !== "b" && result.winner !== "tie") {
    throw new TypeError("Judge winner должен быть a, b или tie.");
  }
  if (
    typeof result.rationale !== "string" ||
    !result.rationale.trim() ||
    Array.from(result.rationale).length > 1_000
  ) {
    throw new TypeError("Judge rationale обязателен и ограничен 1000 символами.");
  }

  return {
    a: parseScores(result.a),
    b: parseScores(result.b),
    winner: result.winner,
    rationale: result.rationale.trim(),
  };
}

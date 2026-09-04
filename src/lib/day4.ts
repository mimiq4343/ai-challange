// Конфигурация эксперимента Day 4: один запрос при трёх температурах.
// Задачи, промпты, параметры и метрики версионируются в коде, не в env.

export const SAMPLES_PER_TEMPERATURE = 3;

export type TemperatureSetting = {
  value: number;
  label: string;
  tagline: string;
};

export const DAY4_TEMPERATURES: TemperatureSetting[] = [
  { value: 0, label: "0", tagline: "Жадный выбор токена: ответ почти детерминирован." },
  { value: 0.7, label: "0.7", tagline: "Умеренный разброс: формулировки гуляют, смысл держится." },
  { value: 1.7, label: "1.7", tagline: "Экстремальный разброс: в выборку попадают заведомо маловероятные токены." },
];

export type Task = {
  prompt: string;
  /** Допустимые формы верного ответа. Пусто — у задачи нет одного верного ответа. */
  accept: string[];
};

export type TaskPreset = Task & {
  id: string;
  kind: string;
  title: string;
  expected: string | null;
};

// Две задачи с проверяемым ответом и две открытые: температуру нужно смотреть
// и там, где правильный ответ один, и там, где его нет вовсе.
export const DAY4_TASKS: TaskPreset[] = [
  {
    id: "arithmetic",
    kind: "точность",
    title: "Многошаговый счёт",
    prompt: "Сколько минут содержится в 3 сутках и 7 часах?",
    expected: "4740",
    accept: ["4740", "4740 минут"],
  },
  {
    id: "position",
    kind: "точность",
    title: "Буква по позиции",
    prompt: "Какая буква стоит на седьмом месте с конца в слове «делопроизводство»?",
    expected: "в",
    accept: ["в", "буква в"],
  },
  {
    id: "slogan",
    kind: "креатив",
    title: "Слоган кофейни",
    prompt:
      "Придумай слоган для кофейни на железнодорожном вокзале. Не длиннее восьми слов, без кавычек и пояснений.",
    expected: null,
    accept: [],
  },
  {
    id: "metaphor",
    kind: "объяснение",
    title: "Метафора рекурсии",
    prompt: "Объясни, что такое рекурсия, одной метафорой. Не длиннее сорока слов.",
    expected: null,
    accept: [],
  },
];

// Требование к формату добавляется только к задачам с эталоном: иначе нечего
// сверять. Открытые задачи уходят как есть, чтобы не стеснять формулировки.
export const ANSWER_RULE =
  "Заверши сообщение отдельной последней строкой строго вида «ОТВЕТ: <значение>» — только само значение, без пояснений.";

// Всё, кроме температуры, у трёх колонок одинаковое: сравниваем один параметр.
export const DAY4_SAMPLING = {
  max_tokens: 400,
  thinking: { type: "disabled" as const },
};

export type Verdict = "correct" | "wrong" | "missing";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractAnswer(text: string): string | null {
  const clean = text.replace(/\*/g, "");
  const matches = [...clean.matchAll(/ОТВЕТ\s*:\s*([^\n]+)/gi)];
  if (matches.length === 0) return null;
  const answer = matches[matches.length - 1][1].trim();
  return answer.length > 0 ? answer : null;
}

export function normalizeAnswer(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[«»"'`]/g, "")
    .replace(/(\d)\s*,\s*(\d)/g, "$1.$2")
    .replace(/\s+/g, " ")
    .replace(/[.!;:]+$/, "")
    .trim();
}

export function verifyAnswer(
  text: string,
  accept: string[],
): { answer: string | null; verdict: Verdict } {
  const answer = extractAnswer(text);
  if (answer === null) return { answer: null, verdict: "missing" };
  const normalized = normalizeAnswer(answer);
  const hit = accept.some((variant) => {
    const expected = normalizeAnswer(variant);
    if (expected.length === 0) return false;
    if (normalized === expected) return true;
    return new RegExp(`(^|\\s)${escapeRegExp(expected)}($|\\s)`).test(normalized);
  });
  return { answer, verdict: hit ? "correct" : "wrong" };
}

/** Слова ответа без пунктуации — основа лексических метрик. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/ответ\s*:.*$/i, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  let shared = 0;
  for (const word of setA) if (setB.has(word)) shared += 1;
  return shared / (setA.size + setB.size - shared);
}

export type DiversityStats = {
  /** Сколько текстов из выборки различны после нормализации. */
  unique: number;
  total: number;
  /** 1 − средняя попарная лексическая близость: 0 — копии, 1 — ничего общего. */
  distinct: number;
  /** Доля уникальных слов во всей выборке. */
  lexicalRichness: number;
  avgWords: number;
};

export function diversityStats(samples: string[]): DiversityStats {
  const texts = samples.map((s) => s.trim()).filter((s) => s.length > 0);
  if (texts.length === 0) {
    return { unique: 0, total: 0, distinct: 0, lexicalRichness: 0, avgWords: 0 };
  }
  const unique = new Set(texts.map((t) => normalizeAnswer(t))).size;
  const tokenized = texts.map(tokenize);

  const pairs: number[] = [];
  for (let i = 0; i < tokenized.length; i += 1) {
    for (let j = i + 1; j < tokenized.length; j += 1) {
      pairs.push(jaccard(tokenized[i], tokenized[j]));
    }
  }
  const distinct = pairs.length === 0 ? 0 : 1 - pairs.reduce((a, b) => a + b, 0) / pairs.length;

  const allWords = tokenized.flat();
  const lexicalRichness = allWords.length === 0 ? 0 : new Set(allWords).size / allWords.length;
  const avgWords = allWords.length / texts.length;

  return { unique, total: texts.length, distinct, lexicalRichness, avgWords };
}

export const JUDGE_SYSTEM = `Ты оцениваешь ответы одной языковой модели на один и тот же запрос, полученные при разных значениях temperature.
Для каждого ответа выставь две оценки по шкале от 1 до 5:
- creativity: насколько формулировка неожиданна и небанальна (1 — шаблон, 5 — свежая находка);
- coherence: насколько ответ связен, уместен и выполняет запрос (1 — бессвязный или не по делу, 5 — безупречный).
Если в ответе есть конкретный дефект — фактическая ошибка, нарушение формата, оборванная мысль, бессмыслица — коротко назови его в поле flaw, иначе оставь flaw пустой строкой.
Отвечай только валидным JSON вида {"scores":[{"id":"строка","creativity":число,"coherence":число,"flaw":"строка"}]} без markdown и пояснений.`;

export function judgeRequest(taskPrompt: string, samples: { id: string; text: string }[]): string {
  const blocks = samples
    .map((s) => `[${s.id}]\n${s.text.trim().slice(0, 1200)}`)
    .join("\n\n");
  return `Запрос, на который отвечала модель:\n\n${taskPrompt}\n\nОтветы:\n\n${blocks}`;
}

export type JudgeScore = { creativity: number; coherence: number; flaw: string };

/** Разбирает ответ судьи; при непарсящемся JSON возвращает пустую карту. */
export function parseJudge(raw: string): Record<string, JudgeScore> {
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) text = fence[1].trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  const scores = (parsed as { scores?: unknown }).scores;
  if (!Array.isArray(scores)) return {};

  const result: Record<string, JudgeScore> = {};
  for (const item of scores) {
    if (typeof item !== "object" || item === null) continue;
    const { id, creativity, coherence, flaw } = item as Record<string, unknown>;
    if (typeof id !== "string") continue;
    if (typeof creativity !== "number" || typeof coherence !== "number") continue;
    result[id] = {
      creativity,
      coherence,
      flaw: typeof flaw === "string" ? flaw : "",
    };
  }
  return result;
}

export function sampleId(temperature: number, index: number): string {
  return `t${temperature}-${index + 1}`;
}

// Конфигурация эксперимента Day 3: одна задача — четыре способа рассуждения.
// Задачи, промпты стратегий и проверка ответа версионируются в коде, не в env.

export type StrategyId = "direct" | "stepwise" | "meta" | "experts";

export type Task = {
  /** Условие, которое уходит модели во всех четырёх способах. */
  prompt: string;
  /** Допустимые формулировки верного ответа для автоматической проверки. */
  accept: string[];
};

export type TaskPreset = Task & {
  id: string;
  kind: string;
  title: string;
  /** Эталон в человекочитаемом виде — показывается в интерфейсе. */
  expected: string;
};

// Задачи подобраны эмпирически: у каждой есть ровно один проверяемый ответ, а
// первые три модель проваливает при прямом ответе — иначе способы рассуждения
// неразличимы. Четвёртая задача контрольная: её модель решает верно любым
// способом, и на ней видно, что разница остаётся только в цене и длине ответа.
export const DAY3_TASKS: TaskPreset[] = [
  {
    id: "position",
    kind: "символьная",
    title: "Буква по позиции",
    prompt: "Какая буква стоит на седьмом месте с конца в слове «делопроизводство»?",
    expected: "в",
    accept: ["в", "буква в"],
  },
  {
    id: "sisters",
    kind: "логическая",
    title: "Сёстры и братья",
    prompt: "У Маши есть 3 брата и 2 сестры. Сколько сестёр у брата Маши?",
    expected: "3",
    accept: ["3", "3 сестры", "три", "три сестры"],
  },
  {
    id: "letters",
    kind: "счётная",
    title: "Буквы во фразе",
    prompt:
      "Сколько раз буква «о» встречается в предложении «Около колодца кольцо не найдёшь»?",
    expected: "7",
    accept: ["7", "7 раз", "семь"],
  },
  {
    id: "minmax",
    kind: "алгоритмическая",
    title: "Минимум и максимум",
    prompt:
      "В массиве из 100 попарно различных чисел нужно найти одновременно и минимум, и максимум. Какого минимального числа сравнений элементов между собой для этого гарантированно достаточно?",
    expected: "148 сравнений (3n/2 − 2)",
    accept: ["148", "148 сравнений"],
  },
];

// Единое требование к формату финальной строки. Добавляется во все четыре
// способа одинаково: без него нечего сверять с эталоном, а на сам метод
// рассуждения оно не влияет.
export const ANSWER_RULE =
  "Заверши сообщение отдельной последней строкой строго вида «ОТВЕТ: <значение>» — в этой строке только само значение, без рассуждений и пояснений.";

// Одинаковые параметры сэмплинга для всех способов: сравниваем промпты, а не
// разброс генерации. thinking отключён намеренно — со встроенным reasoning
// модель рассуждает пошагово сама и разница между способами 1 и 2 исчезает.
export const DAY3_SAMPLING = {
  temperature: 0,
  max_tokens: 1400,
  thinking: { type: "disabled" as const },
};

export const STEPWISE_SYSTEM = `Ты решаешь задачу пошагово.
Разбей решение на пронумерованные шаги. На каждом шаге выписывай промежуточные величины и вычисления явно.
Перед итогом обязательно сделай проверку: подставь найденное значение обратно в условие и убедись, что выполняются все ограничения.
Если проверка не сходится, вернись назад и исправь решение.`;

export const META_ARCHITECT_SYSTEM = `Ты промпт-инженер. По условию задачи ты составляешь промпт для другой языковой модели, которая будет решать эту задачу.
Верни ТОЛЬКО текст промпта: без вступления, без markdown-обрамления и без решения самой задачи.
Промпт должен задавать роль исполнителя, метод рассуждения, подходящий именно этой задаче, обязательную проверку результата и формат вывода.
Не длиннее 200 слов.`;

export function metaArchitectRequest(taskPrompt: string): string {
  return `Задача, для решения которой нужен промпт:\n\n${taskPrompt}`;
}

export const EXPERT_ROLES = [
  {
    key: "analyst",
    name: "Аналитик",
    system: `Ты аналитик экспертной группы. Твоя сила — формализация условия: какие величины даны, какие между ними связи, где в формулировке ловушка.
Реши задачу, опираясь на формальную модель условия. Не длиннее 150 слов.`,
  },
  {
    key: "engineer",
    name: "Инженер",
    system: `Ты инженер экспертной группы. Твоя сила — конкретный расчёт: составь уравнение или алгоритм, доведи до числа и перепроверь результат вторым способом или на уменьшенном примере.
Не длиннее 150 слов.`,
  },
  {
    key: "critic",
    name: "Критик",
    system: `Ты критик экспертной группы. Твоя сила — искать ошибку: назови самый вероятный неверный ответ на эту задачу и объясни, почему он ошибочен, и только затем дай ответ, который считаешь верным.
Не длиннее 150 слов.`,
  },
] as const;

export const SYNTHESIS_SYSTEM = `Ты ведущий экспертной группы. Тебе передают решения аналитика, инженера и критика.
Сопоставь их: в чём эксперты согласны, в чём расходятся, кто и почему ошибся.
Затем дай итоговый ответ группы. Не длиннее 200 слов.`;

export function synthesisRequest(
  taskPrompt: string,
  opinions: { name: string; text: string }[],
): string {
  const blocks = opinions.map((o) => `### ${o.name}\n${o.text.trim()}`).join("\n\n");
  return `Задача:\n\n${taskPrompt}\n\nРешения экспертов:\n\n${blocks}`;
}

export type StrategyMeta = {
  id: StrategyId;
  name: string;
  tagline: string;
  chips: string[];
  calls: number;
};

export const DAY3_STRATEGIES: StrategyMeta[] = [
  {
    id: "direct",
    name: "1. Прямой ответ",
    tagline: "Голое условие без единой инструкции о том, как рассуждать.",
    chips: ["без system", "1 запрос"],
    calls: 1,
  },
  {
    id: "stepwise",
    name: "2. Пошагово",
    tagline: "System prompt требует разбить решение на шаги и проверить итог.",
    chips: ["system: пошагово", "1 запрос"],
    calls: 1,
  },
  {
    id: "meta",
    name: "3. Мета-промпт",
    tagline: "Модель сначала пишет промпт для этой задачи, затем решает по нему.",
    chips: ["промпт от модели", "2 запроса"],
    calls: 2,
  },
  {
    id: "experts",
    name: "4. Группа экспертов",
    tagline: "Аналитик, инженер и критик решают параллельно, ведущий сводит итог.",
    chips: ["3 роли + свод", "4 запроса"],
    calls: 4,
  },
];

export type Verdict = "correct" | "wrong" | "missing";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Последняя строка вида «ОТВЕТ: ...» из ответа модели. */
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

/** Сверяет финальную строку ответа с эталоном задачи. */
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

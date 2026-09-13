// Конфигурация эксперимента Day 5: один и тот же запрос уходит на три модели
// разного класса — слабую, среднюю и сильную. Модели, тарифы и задачи
// версионируются в коде; в окружении лежат только ключи и адреса провайдеров.

export type ProviderId = "deepseek" | "groq";

export type ProviderSpec = {
  label: string;
  baseUrlEnv: string;
  apiKeyEnv: string;
};

export const DAY5_PROVIDERS: Record<ProviderId, ProviderSpec> = {
  deepseek: {
    label: "DeepSeek",
    baseUrlEnv: "OPENAI_BASE_URL",
    apiKeyEnv: "OPENAI_API_KEY",
  },
  groq: {
    label: "Groq",
    baseUrlEnv: "GROQ_BASE_URL",
    apiKeyEnv: "GROQ_API_KEY",
  },
};

/** Тариф провайдера в долларах за миллион токенов. */
export type Rate = {
  input: number;
  /** Повторно поданный контекст, попавший в кэш провайдера. */
  cachedInput: number;
  output: number;
};

export type PricedRate = Rate & { note: string };

// Тарифы DeepSeek зависят от времени суток: в часы пика цена вдвое выше.
// Пик — 01:00–04:00 и 06:00–10:00 UTC по будням, остальное время льготное.
// https://api-docs.deepseek.com/quick_start/pricing
const DEEPSEEK_RATES: Record<string, { peak: Rate; offPeak: Rate }> = {
  "deepseek-v4-flash": {
    peak: { input: 0.44, cachedInput: 0.014, output: 1.32 },
    offPeak: { input: 0.22, cachedInput: 0.007, output: 0.66 },
  },
  "deepseek-v4-pro": {
    peak: { input: 1.32, cachedInput: 0.044, output: 3.96 },
    offPeak: { input: 0.66, cachedInput: 0.022, output: 1.98 },
  },
};

export function isDeepseekPeak(at: Date): boolean {
  const weekday = at.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  const hour = at.getUTCHours() + at.getUTCMinutes() / 60;
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
}

function deepseekRate(model: string, at: Date): PricedRate {
  const tariff = DEEPSEEK_RATES[model];
  if (!tariff) throw new Error(`Не задан тариф DeepSeek для модели ${model}.`);
  const peak = isDeepseekPeak(at);
  return { ...(peak ? tariff.peak : tariff.offPeak), note: peak ? "пиковый тариф" : "льготный тариф" };
}

// Groq берёт одну цену независимо от времени суток.
// https://console.groq.com/docs/models
const GROQ_RATES: Record<string, Rate> = {
  "openai/gpt-oss-120b": { input: 0.15, cachedInput: 0.15, output: 0.6 },
};

function groqRate(model: string): PricedRate {
  const rate = GROQ_RATES[model];
  if (!rate) throw new Error(`Не задан тариф Groq для модели ${model}.`);
  return { ...rate, note: "единый тариф" };
}

export type Tier = "weak" | "mid" | "strong";

export type ModelSpec = {
  id: Tier;
  provider: ProviderId;
  /** Имя модели в API провайдера. */
  model: string;
  tierLabel: string;
  tagline: string;
  /** Параметры, специфичные для модели: они уравнивают глубину рассуждения. */
  params: Record<string, unknown>;
  modelUrl: string;
  priceUrl: string;
};

// Слабая и сильная модели — из одного семейства DeepSeek, поэтому разница между
// ними это разница класса, а не провайдера. Средняя стоит на чужом железе (LPU
// Groq): по способностям она между ними, по скорости — вне конкуренции.
export const DAY5_MODELS: ModelSpec[] = [
  {
    id: "weak",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    tierLabel: "слабая",
    tagline: "Дешёвая рабочая лошадка DeepSeek: та же модель, что в чате на главной.",
    params: { thinking: { type: "disabled" } },
    modelUrl: "https://api-docs.deepseek.com/quick_start/pricing",
    priceUrl: "https://api-docs.deepseek.com/quick_start/pricing",
  },
  {
    id: "mid",
    provider: "groq",
    model: "openai/gpt-oss-120b",
    tierLabel: "средняя",
    tagline: "Открытая MoE-модель OpenAI на LPU Groq: рассуждает вслух, но считает быстро.",
    params: { reasoning_effort: "low" },
    modelUrl: "https://console.groq.com/docs/model/openai/gpt-oss-120b",
    priceUrl: "https://groq.com/pricing",
  },
  {
    id: "strong",
    provider: "deepseek",
    model: "deepseek-v4-pro",
    tierLabel: "сильная",
    tagline: "Старшая модель DeepSeek: втрое дороже flash по входу и вшестеро по выходу.",
    params: { thinking: { type: "disabled" } },
    modelUrl: "https://api-docs.deepseek.com/quick_start/pricing",
    priceUrl: "https://api-docs.deepseek.com/quick_start/pricing",
  },
];

export function modelById(id: string): ModelSpec | undefined {
  return DAY5_MODELS.find((spec) => spec.id === id);
}

export function rateFor(spec: ModelSpec, at: Date): PricedRate {
  return spec.provider === "deepseek" ? deepseekRate(spec.model, at) : groqRate(spec.model);
}

export type Usage = {
  promptTokens: number;
  /** Часть промпта, обслуженная кэшем провайдера: она дешевле свежей. */
  cachedPromptTokens: number;
  completionTokens: number;
  /** Скрытые токены рассуждения внутри completion, если провайдер их считает. */
  reasoningTokens: number;
  totalTokens: number;
};

export const EMPTY_USAGE: Usage = {
  promptTokens: 0,
  cachedPromptTokens: 0,
  completionTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
};

export function costOf(usage: Usage, rate: Rate): number {
  const freshPrompt = Math.max(0, usage.promptTokens - usage.cachedPromptTokens);
  const dollarsPerToken =
    freshPrompt * rate.input +
    usage.cachedPromptTokens * rate.cachedInput +
    usage.completionTokens * rate.output;
  return dollarsPerToken / 1_000_000;
}

/** Метрики одного прогона: их считает сервер, у него есть и время, и usage. */
export type RunMetrics = {
  /** Время до первого токена ответа. */
  ttftMs: number;
  totalMs: number;
  usage: Usage;
  costUsd: number;
  rateNote: string;
  /** Токенов ответа в секунду после первого токена — чистая скорость генерации. */
  tokensPerSec: number | null;
};

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

// Пять задач: три с проверяемым ответом (счёт, логика, работа с буквами) и две
// открытые. Разницу классов моделей нужно видеть и там, где ответ один, и там,
// где его оценивает только судья.
export const DAY5_TASKS: TaskPreset[] = [
  {
    id: "logic",
    kind: "логика",
    title: "Сёстры и братья",
    prompt:
      "У Марии четыре брата и три сестры. Сколько сестёр у брата Марии? Объясни ход рассуждения в двух предложениях.",
    expected: "4",
    accept: ["4", "четыре", "4 сестры", "четыре сестры"],
  },
  {
    id: "price",
    kind: "счёт",
    title: "Наценка и скидка",
    prompt:
      "Товар стоил 4800 ₽. Сначала цену подняли на 25%, затем от новой цены дали скидку 20%. Сколько стоит товар теперь? Покажи вычисления коротко.",
    expected: "4800",
    accept: ["4800", "4800 ₽", "4800 руб", "4800 рублей"],
  },
  {
    id: "letters",
    kind: "буквы",
    title: "Счёт букв",
    prompt: "Сколько букв «р» в слове «перераспределение»? Перечисли их по порядку.",
    expected: "3",
    accept: ["3", "три", "3 буквы", "три буквы"],
  },
  {
    id: "explain",
    kind: "объяснение",
    title: "Процесс и поток",
    prompt:
      "Объясни разницу между процессом и потоком одной метафорой, без терминов операционных систем. Не длиннее сорока слов.",
    expected: null,
    accept: [],
  },
  {
    id: "code",
    kind: "код",
    title: "Функция debounce",
    prompt:
      "Напиши на TypeScript функцию debounce с точными типами: она принимает функцию и задержку в миллисекундах, возвращает обёртку с тем же списком аргументов и методом cancel. Только код, без пояснений.",
    expected: null,
    accept: [],
  },
];

export const ANSWER_RULE =
  "Заверши сообщение отдельной последней строкой строго вида «ОТВЕТ: <значение>» — только само значение, без пояснений.";

// Условия у трёх колонок одинаковые: общий system prompt, нулевая температура и
// один потолок длины. Различается только модель — иначе сравнивать нечего.
export const DAY5_SYSTEM = `Отвечай по существу и без вступлений. Соблюдай ограничения по длине, заданные в запросе.
Ответ должен быть законченным — не обрывай фразу и не оставляй мысль недосказанной.
Если в запросе нет своего ограничения, не пиши длиннее 200 слов.`;

export const DAY5_SAMPLING = {
  temperature: 0,
  max_tokens: 1200,
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

export function verifyAnswer(text: string, accept: string[]): { answer: string | null; verdict: Verdict } {
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

export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
}

// Судья не должен знать, какая модель что написала: ответы приходят к нему под
// метками A, B, C в перемешанном порядке, а сам он работает при нулевой
// температуре и строгом JSON, чтобы оценки были воспроизводимы.
export const JUDGE_SYSTEM = `Ты сравниваешь ответы трёх анонимных языковых моделей на один и тот же запрос.
Для каждого ответа выставь оценки по шкале от 1 до 5:
- correctness: насколько ответ верен по существу (1 — грубая ошибка, 5 — безупречно верно);
- usefulness: насколько ответ полон и удобен читателю при заданных ограничениях (1 — бесполезен, 5 — образцовый).
Если в ответе есть конкретный дефект — фактическая ошибка, нарушение формата, оборванная мысль, лишнее многословие — коротко назови его в поле flaw, иначе оставь flaw пустой строкой.
В поле best укажи метку лучшего ответа, в поле verdict — одно предложение о том, чем ответы отличаются друг от друга.
Отвечай только валидным JSON вида {"scores":[{"id":"A","correctness":число,"usefulness":число,"flaw":"строка"}],"best":"A","verdict":"строка"} без markdown и пояснений.`;

export function judgeRequest(taskPrompt: string, samples: { id: string; text: string }[]): string {
  const blocks = samples.map((s) => `[${s.id}]\n${s.text.trim().slice(0, 2000)}`).join("\n\n");
  return `Запрос, на который отвечали модели:\n\n${taskPrompt}\n\nОтветы:\n\n${blocks}`;
}

export type JudgeScore = { correctness: number; usefulness: number; flaw: string };

export type JudgeResult = {
  scores: Record<string, JudgeScore>;
  best: string | null;
  verdict: string;
};

export function parseJudge(raw: string): JudgeResult {
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) text = fence[1].trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { scores: {}, best: null, verdict: "" };
  }
  const root = parsed as { scores?: unknown; best?: unknown; verdict?: unknown };
  const scores: Record<string, JudgeScore> = {};
  if (Array.isArray(root.scores)) {
    for (const item of root.scores) {
      if (typeof item !== "object" || item === null) continue;
      const { id, correctness, usefulness, flaw } = item as Record<string, unknown>;
      if (typeof id !== "string") continue;
      if (typeof correctness !== "number" || typeof usefulness !== "number") continue;
      scores[id] = {
        correctness,
        usefulness,
        flaw: typeof flaw === "string" ? flaw : "",
      };
    }
  }
  return {
    scores,
    best: typeof root.best === "string" ? root.best : null,
    verdict: typeof root.verdict === "string" ? root.verdict : "",
  };
}

export function formatUsd(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.001) return `$${value.toFixed(6)}`;
  if (value < 1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function formatMs(value: number): string {
  return value < 1000 ? `${Math.round(value)} мс` : `${(value / 1000).toFixed(1)} с`;
}

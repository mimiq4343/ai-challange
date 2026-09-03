// Сценарии четырёх способов рассуждения Day 3: каждый способ раскладывается на
// фазы, каждая фаза — отдельный вызов /api/chat со стримингом.

import {
  ANSWER_RULE,
  DAY3_SAMPLING,
  EXPERT_ROLES,
  META_ARCHITECT_SYSTEM,
  STEPWISE_SYSTEM,
  SYNTHESIS_SYSTEM,
  metaArchitectRequest,
  synthesisRequest,
  type StrategyId,
  type Task,
} from "./day3";

export type PhaseSpec = { label: string; mono?: boolean };

export type RunnerEvents = {
  /** Объявляет структуру способа до первого токена. */
  initPhases: (phases: PhaseSpec[]) => void;
  appendPhase: (index: number, chunk: string) => void;
};

/** Максимальная длина system prompt, которую принимает /api/chat. */
const SYSTEM_LIMIT = 8000;

async function streamCall(
  body: Record<string, unknown>,
  signal: AbortSignal,
  onDelta: (chunk: string) => void,
): Promise<string> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? `Сервер вернул ${res.status}.`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    full += chunk;
    onDelta(chunk);
  }
  return full;
}

function solveRequest(taskPrompt: string, system?: string): Record<string, unknown> {
  return {
    messages: [{ role: "user", content: `${taskPrompt}\n\n${ANSWER_RULE}` }],
    ...(system ? { system } : {}),
    ...DAY3_SAMPLING,
  };
}

/** Снимает markdown-обрамление, если модель вернула промпт в блоке кода. */
function unfence(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```[a-z]*\s*([\s\S]*?)\s*```$/i);
  return (fence ? fence[1] : trimmed).trim();
}

async function runDirect(task: Task, signal: AbortSignal, events: RunnerEvents): Promise<string> {
  events.initPhases([{ label: "Ответ модели" }]);
  return streamCall(solveRequest(task.prompt), signal, (chunk) => events.appendPhase(0, chunk));
}

async function runStepwise(task: Task, signal: AbortSignal, events: RunnerEvents): Promise<string> {
  events.initPhases([{ label: "Пошаговое решение" }]);
  return streamCall(solveRequest(task.prompt, STEPWISE_SYSTEM), signal, (chunk) =>
    events.appendPhase(0, chunk),
  );
}

async function runMeta(task: Task, signal: AbortSignal, events: RunnerEvents): Promise<string> {
  events.initPhases([
    { label: "Шаг 1. Промпт, составленный моделью", mono: true },
    { label: "Шаг 2. Решение по этому промпту" },
  ]);
  const generated = await streamCall(
    {
      messages: [{ role: "user", content: metaArchitectRequest(task.prompt) }],
      system: META_ARCHITECT_SYSTEM,
      ...DAY3_SAMPLING,
    },
    signal,
    (chunk) => events.appendPhase(0, chunk),
  );
  const prompt = unfence(generated).slice(0, SYSTEM_LIMIT);
  if (prompt.length === 0) {
    throw new Error("Модель не вернула промпт на первом шаге — решать нечем.");
  }
  return streamCall(solveRequest(task.prompt, prompt), signal, (chunk) =>
    events.appendPhase(1, chunk),
  );
}

async function runExperts(task: Task, signal: AbortSignal, events: RunnerEvents): Promise<string> {
  const synthesisIndex = EXPERT_ROLES.length;
  events.initPhases([
    ...EXPERT_ROLES.map((role) => ({ label: role.name })),
    { label: "Свод ведущего" },
  ]);
  const opinions = await Promise.all(
    EXPERT_ROLES.map(async (role, index) => ({
      name: role.name,
      text: await streamCall(solveRequest(task.prompt, role.system), signal, (chunk) =>
        events.appendPhase(index, chunk),
      ),
    })),
  );
  return streamCall(
    {
      messages: [
        {
          role: "user",
          content: `${synthesisRequest(task.prompt, opinions)}\n\n${ANSWER_RULE}`,
        },
      ],
      system: SYNTHESIS_SYSTEM,
      ...DAY3_SAMPLING,
    },
    signal,
    (chunk) => events.appendPhase(synthesisIndex, chunk),
  );
}

const RUNNERS: Record<
  StrategyId,
  (task: Task, signal: AbortSignal, events: RunnerEvents) => Promise<string>
> = {
  direct: runDirect,
  stepwise: runStepwise,
  meta: runMeta,
  experts: runExperts,
};

/** Выполняет способ целиком и возвращает текст последней фазы — он и есть ответ способа. */
export function runStrategy(
  id: StrategyId,
  task: Task,
  signal: AbortSignal,
  events: RunnerEvents,
): Promise<string> {
  return RUNNERS[id](task, signal, events);
}

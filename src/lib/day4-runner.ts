// Вызовы API для эксперимента Day 4: выборка ответов при заданной температуре
// и отдельный запрос-судья, оценивающий все полученные ответы разом.

import {
  ANSWER_RULE,
  DAY4_SAMPLING,
  JUDGE_SYSTEM,
  judgeRequest,
  parseJudge,
  type JudgeScore,
  type Task,
} from "./day4";

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

/** Один ответ при заданной температуре. Формат ответа требуем только там, где есть эталон. */
export function runSample(
  task: Task,
  temperature: number,
  signal: AbortSignal,
  onDelta: (chunk: string) => void,
): Promise<string> {
  const content = task.accept.length > 0 ? `${task.prompt}\n\n${ANSWER_RULE}` : task.prompt;
  return streamCall(
    { messages: [{ role: "user", content }], temperature, ...DAY4_SAMPLING },
    signal,
    onDelta,
  );
}

/** Судья работает при temperature 0 и строгом JSON: его оценки должны быть воспроизводимы. */
export async function runJudge(
  task: Task,
  samples: { id: string; text: string }[],
  signal: AbortSignal,
): Promise<Record<string, JudgeScore>> {
  const raw = await streamCall(
    {
      messages: [{ role: "user", content: judgeRequest(task.prompt, samples) }],
      system: JUDGE_SYSTEM,
      temperature: 0,
      max_tokens: 900,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
    },
    signal,
    () => {},
  );
  return parseJudge(raw);
}

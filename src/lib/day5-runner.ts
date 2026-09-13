// Клиентские вызовы эксперимента Day 5: прогон одной задачи на выбранной модели
// и слепой запрос-судья, сравнивающий полученные ответы между собой.

import {
  ANSWER_RULE,
  DAY5_SAMPLING,
  DAY5_SYSTEM,
  JUDGE_SYSTEM,
  judgeRequest,
  parseJudge,
  type JudgeResult,
  type ModelSpec,
  type RunMetrics,
  type Task,
} from "./day5";

export type RunResult = { text: string; metrics: RunMetrics };

type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; metrics: RunMetrics }
  | { type: string; [key: string]: unknown };

/** Читает NDJSON-поток маршрута: дельты отдаёт наружу, метрики возвращает в конце. */
async function streamCall(
  body: Record<string, unknown>,
  signal: AbortSignal,
  onDelta: (chunk: string) => void,
): Promise<RunResult> {
  const res = await fetch("/api/day5", {
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
  let buffer = "";
  let text = "";
  let metrics: RunMetrics | null = null;

  const consume = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return;
    let event: StreamEvent;
    try {
      event = JSON.parse(trimmed) as StreamEvent;
    } catch {
      return; // строка пришла разрезанной, следующий кусок допишет её в буфер
    }
    if (event.type === "delta" && typeof event.text === "string") {
      text += event.text;
      onDelta(event.text);
    } else if (event.type === "done") {
      metrics = (event as { metrics: RunMetrics }).metrics;
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const raw of lines) consume(raw);
  }
  consume(buffer);

  if (metrics === null) throw new Error("Поток завершился без метрик прогона.");
  return { text, metrics };
}

/** Один прогон задачи на одной модели. Формат ответа требуем только там, где есть эталон. */
export function runModel(
  spec: ModelSpec,
  task: Task,
  signal: AbortSignal,
  onDelta: (chunk: string) => void,
): Promise<RunResult> {
  const content = task.accept.length > 0 ? `${task.prompt}\n\n${ANSWER_RULE}` : task.prompt;
  return streamCall(
    {
      modelId: spec.id,
      messages: [{ role: "user", content }],
      system: DAY5_SYSTEM,
      ...DAY5_SAMPLING,
    },
    signal,
    onDelta,
  );
}

/**
 * Судья видит ответы под анонимными метками и не знает, какая модель что
 * написала. Работает на сильной модели при нулевой температуре и строгом JSON.
 */
export async function runJudge(
  taskPrompt: string,
  samples: { id: string; text: string }[],
  signal: AbortSignal,
): Promise<JudgeResult> {
  const { text } = await streamCall(
    {
      modelId: "strong",
      messages: [{ role: "user", content: judgeRequest(taskPrompt, samples) }],
      system: JUDGE_SYSTEM,
      temperature: 0,
      max_tokens: 1200,
      response_format: { type: "json_object" },
    },
    signal,
    () => {},
  );
  return parseJudge(text);
}

import type { ChatMessage } from "./chat-agent";
import type { CompressionLlmResponder } from "./compression-llm";
import { RagError } from "./rag-agent";
import { RAG_CONFIG } from "./rag-config";
import { RAG_CHAT_CONFIG, RAG_TASK_MEMORY_PROMPT } from "./rag-chat-config";
import type { RagTaskState, TaskMemoryEntry, TaskMemoryFact } from "./rag-chat-types";
import { assertContextFits, countChatPrompt } from "./token-counter";

const kinds = ["clarifications", "constraints", "terms"] as const;

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) throw new RagError("Неверная структура памяти задачи.", 502);
  return value as Record<string, unknown>;
}

function text(value: unknown, limit: number = RAG_CHAT_CONFIG.maxMemoryCharacters): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw new RagError("Память задачи содержит пустую или слишком длинную строку.", 502);
  return value.trim();
}

function fact(value: unknown, withKey: boolean): TaskMemoryFact | TaskMemoryEntry {
  const row = object(value, withKey ? ["key", "value", "evidence", "turn"] : ["value", "evidence", "turn"]);
  if (!Number.isSafeInteger(row.turn) || (row.turn as number) < 1) throw new RagError("Уточнение памяти должно ссылаться на ход пользователя.", 502);
  return { value: text(row.value), evidence: text(row.evidence), turn: row.turn as number, ...(withKey ? { key: text(row.key) } : {}) };
}

export function validateRagTaskState(value: unknown): RagTaskState {
  const row = object(value, ["goal", ...kinds]);
  const result: RagTaskState = { goal: row.goal === null ? null : fact(row.goal, false), clarifications: [], constraints: [], terms: [] };
  for (const kind of kinds) {
    const entries = row[kind];
    if (!Array.isArray(entries) || entries.length > RAG_CHAT_CONFIG.maxMemoryEntries) throw new RagError("Превышен лимит памяти задачи.", 502);
    result[kind] = entries.map((entry) => fact(entry, true) as TaskMemoryEntry);
    if (new Set(result[kind].map((entry) => entry.key)).size !== entries.length) throw new RagError("Ключи памяти задачи повторяются.", 502);
  }
  return result;
}

export function applyTaskMemoryPatch(previous: RagTaskState, decoded: unknown, content: string, turn: number) {
  const patch = object(decoded, ["goal", "upsert", "remove", "question"]);
  const state = structuredClone(validateRagTaskState(previous));
  const evidence = (value: unknown) => {
    const quote = text(value);
    if (!content.includes(quote)) throw new RagError("Уточнение памяти не подтверждено текущим сообщением пользователя.", 502);
    return quote;
  };
  if (patch.goal !== null) {
    const goal = object(patch.goal, ["value", "evidence"]);
    state.goal = { value: text(goal.value), evidence: evidence(goal.evidence), turn };
  }
  const seen = new Set<string>();
  for (const action of ["upsert", "remove"] as const) {
    const rows = patch[action];
    if (!Array.isArray(rows) || rows.length > RAG_CHAT_CONFIG.maxMemoryEntries * kinds.length) throw new RagError("Неверный список изменений памяти.", 502);
    for (const input of rows) {
      const row = object(input, action === "upsert" ? ["kind", "key", "value", "evidence"] : ["kind", "key", "evidence"]);
      if (!kinds.includes(row.kind as typeof kinds[number])) throw new RagError("Неизвестный вид уточнения памяти.", 502);
      const kind = row.kind as typeof kinds[number];
      const key = text(row.key);
      const identity = JSON.stringify([kind, key]);
      if (seen.has(identity)) throw new RagError("Изменение одного ключа памяти повторяется.", 502);
      seen.add(identity);
      const quote = evidence(row.evidence);
      const index = state[kind].findIndex((entry) => entry.key === key);
      if (action === "remove") {
        if (index < 0) throw new RagError("Нельзя отменить отсутствующее уточнение памяти.", 502);
        state[kind].splice(index, 1);
      } else {
        const entry = { key, value: text(row.value), evidence: quote, turn };
        if (index < 0) state[kind].push(entry);
        else state[kind][index] = entry;
      }
    }
  }
  const question = text(patch.question, RAG_CONFIG.maxQuestionCharacters);
  const identifiers = content.match(/\b(?:[a-z]+[A-Z][A-Za-z0-9]*|[A-Z][a-z]+[A-Z][A-Za-z0-9]*|[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_.]*|[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+)\b/g) ?? [];
  if (identifiers.some((identifier) => !question.includes(identifier))) throw new RagError("Поисковый вопрос потерял исходный идентификатор кода.", 502);
  return { taskState: validateRagTaskState(state), question };
}

export async function updateRagTaskMemory(llm: CompressionLlmResponder, previousState: RagTaskState, history: ChatMessage[], content: string, turn: number, signal: AbortSignal) {
  const request = JSON.stringify({ previousState, history, content });
  assertContextFits(await countChatPrompt({ systemMessages: [RAG_TASK_MEMORY_PROMPT], history: [], request, reservedOutputTokens: RAG_CONFIG.maxOutputTokens }));
  signal.throwIfAborted();
  const response = await llm.respond([{ role: "user", content: request }], signal, { systemMessages: [RAG_TASK_MEMORY_PROMPT], strictStream: true, maxOutputTokens: RAG_CONFIG.maxOutputTokens });
  const output = await new Response(response.stream).text();
  signal.throwIfAborted();
  const usage = await response.usage;
  if (await response.finishReason !== "stop" || !usage || output.length > RAG_CONFIG.maxAnswerCharacters) throw new RagError("Обновление памяти задачи не завершено или не содержит статистику токенов.", 502);
  let decoded: unknown;
  try { decoded = JSON.parse(output); }
  catch (cause) { throw new RagError("LLM вернула недействительный JSON памяти задачи.", 502, { cause }); }
  return { ...applyTaskMemoryPatch(previousState, decoded, content, turn), usage };
}

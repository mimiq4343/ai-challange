import type { ConversationDetail } from "./conversation-types";
import type { GroundedAnswer } from "./rag-grounding-types";

export type TaskMemoryFact = { value: string; evidence: string; turn: number };
export type TaskMemoryEntry = TaskMemoryFact & { key: string };
export type RagTaskState = {
  goal: TaskMemoryFact | null;
  clarifications: TaskMemoryEntry[];
  constraints: TaskMemoryEntry[];
  terms: TaskMemoryEntry[];
};
export type RagChatExchange = { assistantMessageId: number; taskState: RagTaskState; answer: GroundedAnswer };
export type RagChatSnapshot = ConversationDetail & { taskState: RagTaskState; exchanges: RagChatExchange[] };
export type RagChatCommit = { expectedLastMessageId: number | null; taskState: RagTaskState; answer: GroundedAnswer };

export function emptyRagTaskState(): RagTaskState {
  return { goal: null, clarifications: [], constraints: [], terms: [] };
}

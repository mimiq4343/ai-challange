import { ConversationNotFoundError, type SqliteConversationStore } from "./conversation-store";
import {
  MEMORY_CATEGORY_LABELS,
  type LongTermMemoryCategory,
  type MemorySnapshot,
  type StoredLongTermMemory,
  type StoredWorkingMemory,
} from "./conversation-types";
import { countTextTokens } from "./token-counter";

const CATEGORY_ORDER: readonly LongTermMemoryCategory[] = [
  "profile",
  "decision",
  "knowledge",
];

export function renderMemoryContext(
  longTerm: StoredLongTermMemory[],
  working: StoredWorkingMemory[],
): string | null {
  const sections: string[] = [];

  if (longTerm.length > 0) {
    const ordered = [...longTerm].sort(
      (a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category),
    );
    const lines = ordered.map(
      (entry) => `- [${MEMORY_CATEGORY_LABELS[entry.category]}] ${entry.content}`,
    );
    sections.push(
      [
        "## Долговременная память (факты о пользователе, решения и знания; действуют во всех диалогах)",
        ...lines,
      ].join("\n"),
    );
  }

  if (working.length > 0) {
    const lines = working.map((entry) => `- ${entry.content}`);
    sections.push(
      [
        "## Рабочая память текущей задачи (действует только в этом диалоге)",
        ...lines,
      ].join("\n"),
    );
  }

  return sections.length > 0 ? sections.join("\n\n") : null;
}

export function buildSystemPrompt(
  basePrompt: string,
  longTerm: StoredLongTermMemory[],
  working: StoredWorkingMemory[],
): string {
  const context = renderMemoryContext(longTerm, working);
  return context ? `${basePrompt}\n\n${context}` : basePrompt;
}

export async function getMemorySnapshot(
  store: SqliteConversationStore,
  conversationId: string | null,
): Promise<MemorySnapshot> {
  const conversation = conversationId ? store.getConversation(conversationId) : null;
  if (conversationId && !conversation) {
    throw new ConversationNotFoundError(conversationId);
  }

  const messages = conversation ? store.getMessages(conversation.id) : [];
  const working = conversation ? store.listWorkingMemory(conversation.id) : [];
  const longTerm = store.listLongTermMemory();

  const [messageTokens, workingTokens, longTermTokens] = await Promise.all([
    Promise.all(messages.map((message) => countTextTokens(message.content))),
    Promise.all(working.map((entry) => countTextTokens(entry.content))),
    Promise.all(longTerm.map((entry) => countTextTokens(entry.content))),
  ]);

  const systemContext = renderMemoryContext(longTerm, working);

  return {
    conversationId: conversation?.id ?? null,
    shortTerm: {
      messageCount: messages.length,
      tokens: messageTokens.reduce((total, tokens) => total + tokens, 0),
    },
    working: working.map((entry, index) => ({ ...entry, tokens: workingTokens[index] })),
    longTerm: longTerm.map((entry, index) => ({ ...entry, tokens: longTermTokens[index] })),
    systemContext,
    memoryContextTokens: systemContext ? await countTextTokens(systemContext) : 0,
  };
}

export type MessageRole = "user" | "assistant";

export type ConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type StoredMessage = {
  id: number;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
};

export type ConversationDetail = {
  conversation: ConversationSummary;
  messages: StoredMessage[];
};

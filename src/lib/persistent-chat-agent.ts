import { ChatAgent, ChatAgentError, type ChatMessage } from "./chat-agent";
import {
  ConversationNotFoundError,
  getConversationStore,
  type SqliteConversationStore,
} from "./conversation-store";

type LlmResponder = Pick<ChatAgent, "respond">;

export class PersistentChatAgent {
  private readonly store: SqliteConversationStore;
  private readonly llm: LlmResponder;

  constructor(store: SqliteConversationStore, llm: LlmResponder) {
    this.store = store;
    this.llm = llm;
  }

  static fromEnvironment(
    store: SqliteConversationStore = getConversationStore(),
  ): PersistentChatAgent {
    return new PersistentChatAgent(store, ChatAgent.fromEnvironment());
  }

  async respond(
    conversationId: string,
    content: string,
    signal: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    if (!this.store.getConversation(conversationId)) {
      throw new ConversationNotFoundError(conversationId);
    }

    const messages: ChatMessage[] = this.store
      .getMessages(conversationId)
      .map(({ role, content: savedContent }) => ({ role, content: savedContent }));
    messages.push({ role: "user", content });

    const source = await this.llm.respond(messages, signal);
    const chunks: Uint8Array[] = [];

    return source.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          chunks.push(chunk.slice());
          controller.enqueue(chunk);
        },
        flush: () => {
          const totalBytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
          const completeResponse = new Uint8Array(totalBytes);
          let offset = 0;
          for (const chunk of chunks) {
            completeResponse.set(chunk, offset);
            offset += chunk.byteLength;
          }

          const assistantContent = new TextDecoder().decode(completeResponse);
          if (assistantContent.length === 0) {
            throw new ChatAgentError("API вернул пустой ответ.", "upstream");
          }
          this.store.saveExchange(conversationId, content, assistantContent);
        },
      }),
    );
  }
}

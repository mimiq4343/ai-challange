import { getConversationStore } from "@/lib/conversation-store";
import { SHORT_TERM_WINDOW_MESSAGES } from "@/lib/memory-composer";
import { getMemoryStore } from "@/lib/memory-store";
import { getProfileStore } from "@/lib/profile-store";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const store = getConversationStore();
  if (!store.getConversation(id)) {
    return Response.json({ error: "Диалог не найден." }, { status: 404 });
  }

  const messages = store.getMessages(id);
  const snapshot = getMemoryStore().getSnapshot(id, getProfileStore().getActiveProfile().id, {
    windowMessages: SHORT_TERM_WINDOW_MESSAGES,
    totalMessages: messages.length,
    includedMessages: Math.min(messages.length, SHORT_TERM_WINDOW_MESSAGES),
  });

  return Response.json({ memory: snapshot });
}

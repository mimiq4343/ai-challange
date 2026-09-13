import { getConversationStore } from "@/lib/conversation-store";

export const runtime = "nodejs";

export function GET() {
  try {
    return Response.json({ conversations: getConversationStore().listConversations() });
  } catch (error) {
    console.error("Не удалось прочитать список диалогов.", error);
    return Response.json({ error: "Не удалось загрузить список диалогов." }, { status: 500 });
  }
}

export function POST() {
  try {
    return Response.json(
      { conversation: getConversationStore().createConversation() },
      { status: 201 },
    );
  } catch (error) {
    console.error("Не удалось создать диалог.", error);
    return Response.json({ error: "Не удалось создать диалог." }, { status: 500 });
  }
}

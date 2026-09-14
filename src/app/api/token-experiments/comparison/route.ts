import { getConversationStore } from "@/lib/conversation-store";
import { getComparisonScenarios } from "@/lib/token-analytics";

export const runtime = "nodejs";

export async function GET() {
  try {
    const comparison = await getComparisonScenarios(getConversationStore());
    return Response.json(comparison, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Не удалось построить сравнение токенов.", error);
    return Response.json({ error: "Не удалось построить сравнение токенов." }, { status: 500 });
  }
}

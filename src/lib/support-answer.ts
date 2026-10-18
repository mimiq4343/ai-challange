import { answerCitations } from "./dev-assistant-sources";
import type { McpToolEvent } from "./mcp-chat-types";
import { SupportDataError } from "./support-data";
import { supportSearchSchema, type SupportSource, type SupportTicket } from "./support-types";

export function validateSupportAnswer(answer: string, ticket: SupportTicket, events: readonly McpToolEvent[]): SupportSource[] {
  const names = new Map<string, string>();
  const sources: SupportSource[] = [];
  let gotTicket = false, gotUser = false, searched = false;
  for (const event of events) {
    if (event.type === "tool-start") { names.set(event.callId, event.name); continue; }
    if (event.result.isError) continue;
    const data = event.result.structuredContent;
    const name = names.get(event.callId);
    if (name === "get_ticket" && (data?.ticket as { id?: string } | undefined)?.id === ticket.id) gotTicket = true;
    if (name === "get_user" && (data?.user as { id?: string } | undefined)?.id === ticket.userId) gotUser = true;
    if (name === "search_knowledge") {
      const parsed = supportSearchSchema.parse(data);
      searched = true;
      if (parsed.stale) throw new SupportDataError("База знаний изменилась. Пересоздайте индекс: npm run support:index.", 409);
      for (const source of parsed.results) if (!sources.some(item => item.id === source.id)) sources.push(source);
    }
  }
  if (!gotTicket || !gotUser || !searched) throw new SupportDataError("Ассистент не получил обязательный контекст тикета, пользователя и базы знаний.", 502);
  const { cited, unknown } = answerCitations(answer, sources);
  if (unknown.length) throw new SupportDataError("Ответ ссылается на неизвестный источник.", 502);
  if (!sources.length && (!/не знаю/i.test(answer) || !answer.includes("?"))) throw new SupportDataError("В базе знаний нет подтверждения: нужен честный отказ и уточняющий вопрос.", 502);
  if (sources.length && !cited.length && !/не знаю/i.test(answer)) throw new SupportDataError("В ответе отсутствуют ссылки на найденную документацию.", 502);
  return sources.filter(source => cited.includes(source.id));
}

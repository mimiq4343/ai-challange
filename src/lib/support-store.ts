import { openChatDatabase, releaseChatDatabase } from "./sqlite-database";
import { SUPPORT_CONFIG } from "./support-config";
import { SupportDataError } from "./support-data";
import { supportSourceSchema, type SupportExchange, type SupportSource } from "./support-types";

export class SupportStore {
  private readonly database;
  constructor(private readonly path: string) {
    this.database = openChatDatabase(path);
    this.database.exec(`CREATE TABLE IF NOT EXISTS support_exchanges (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id TEXT NOT NULL,
      question TEXT NOT NULL CHECK(length(trim(question)) > 0),
      answer TEXT NOT NULL CHECK(length(trim(answer)) > 0),
      sources_json TEXT NOT NULL CHECK(json_valid(sources_json)), created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS support_exchanges_ticket ON support_exchanges(ticket_id, id);`);
  }
  read(ticketId: string): SupportExchange[] {
    const rows = this.database.prepare("SELECT id, question, answer, sources_json, created_at FROM support_exchanges WHERE ticket_id = ? ORDER BY id").all(ticketId);
    return rows.map(row => ({ id: Number(row.id), question: String(row.question), answer: String(row.answer), sources: supportSourceSchema.array().parse(JSON.parse(String(row.sources_json))), createdAt: String(row.created_at) }));
  }
  save(ticketId: string, expectedCursor: number | null, question: string, answer: string, sources: SupportSource[]): SupportExchange {
    if (!question.trim() || !answer.trim()) throw new SupportDataError("Нельзя сохранить пустой обмен.");
    const checkedSources = supportSourceSchema.array().parse(sources);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const state = this.database.prepare("SELECT max(id) AS cursor, count(*) AS count FROM support_exchanges WHERE ticket_id = ?").get(ticketId)!;
      if (state.cursor !== expectedCursor) throw new SupportDataError("Диалог изменился. Обновите тикет перед отправкой.", 409);
      if (Number(state.count) >= SUPPORT_CONFIG.maxExchanges) throw new SupportDataError("Достигнут лимит переписки этого учебного тикета.", 409);
      const createdAt = new Date().toISOString();
      const result = this.database.prepare("INSERT INTO support_exchanges(ticket_id, question, answer, sources_json, created_at) VALUES (?, ?, ?, ?, ?)").run(ticketId, question, answer, JSON.stringify(checkedSources), createdAt);
      this.database.exec("COMMIT");
      return { id: Number(result.lastInsertRowid), question, answer, sources: checkedSources, createdAt };
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
  close(): void { releaseChatDatabase(this.path); }
}

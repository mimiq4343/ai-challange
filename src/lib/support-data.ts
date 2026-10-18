import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { SUPPORT_CONFIG } from "./support-config";
import { supportTicketSchema, supportUserSchema, type SupportData, type SupportTicket } from "./support-types";

export class SupportDataError extends Error {
  constructor(message: string, readonly status = 400, options?: ErrorOptions) { super(message, options); }
}

export function parseSupportData(value: unknown): SupportData {
  const parsed = z.strictObject({ demo: z.literal(true), users: z.array(supportUserSchema).min(1), tickets: z.array(supportTicketSchema).min(1) }).safeParse(value);
  if (!parsed.success) throw new SupportDataError("Неверный JSON пользователей и тикетов.", 500);
  const data = parsed.data;
  const userIds = new Set(data.users.map(user => user.id));
  if (userIds.size !== data.users.length || new Set(data.tickets.map(ticket => ticket.id)).size !== data.tickets.length || data.tickets.some(ticket => !userIds.has(ticket.userId))) {
    throw new SupportDataError("Неуникальные ID или отсутствующий пользователь тикета в JSON.", 500);
  }
  return data;
}

export async function loadSupportData(root = process.cwd()): Promise<SupportData> {
  let value: unknown;
  try { value = JSON.parse(await readFile(resolve(root, SUPPORT_CONFIG.fixturesPath), "utf8")); }
  catch (cause) { throw new SupportDataError("Не удалось прочитать JSON пользователей и тикетов.", 500, { cause }); }
  return parseSupportData(value);
}

export function requireSupportTicket(data: SupportData, id: string): SupportTicket {
  const ticket = data.tickets.find(ticket => ticket.id === id);
  if (!ticket) throw new SupportDataError("Тикет не найден.", 404);
  return ticket;
}

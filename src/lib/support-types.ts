import { z } from "zod";

export const supportUserSchema = z.strictObject({
  id: z.string().min(1), name: z.string().min(1), organization: z.string().min(1),
  environment: z.string().min(1), product: z.literal("Flash Chat"),
});
export const supportTicketSchema = z.strictObject({
  id: z.string().regex(/^SUP-\d+$/), userId: z.string().min(1), title: z.string().min(1),
  description: z.string().min(1), status: z.enum(["open", "pending", "resolved"]),
  createdAt: z.iso.datetime(), diagnostics: z.array(z.string().min(1)),
  history: z.array(z.strictObject({ at: z.iso.datetime(), text: z.string().min(1) })),
});
export const supportSourceSchema = z.strictObject({
  id: z.string().regex(/^S[1-9]\d*$/), source: z.string().min(1), section: z.string(),
  startLine: z.number().int().positive(), endLine: z.number().int().positive(),
  score: z.number().finite(), text: z.string().min(1),
});
export const supportSearchSchema = z.strictObject({ results: z.array(supportSourceSchema), stale: z.boolean() });
export type SupportUser = z.infer<typeof supportUserSchema>;
export type SupportTicket = z.infer<typeof supportTicketSchema>;
export type SupportSource = z.infer<typeof supportSourceSchema>;
export type SupportSearch = z.infer<typeof supportSearchSchema>;
export type SupportData = { demo: true; users: SupportUser[]; tickets: SupportTicket[] };
export type SupportExchange = { id: number; question: string; answer: string; sources: SupportSource[]; createdAt: string };
export type SupportTicketState = { ticket: SupportTicket; user: SupportUser; exchanges: SupportExchange[] };

export const supportToolSchemas = {
  get_ticket: z.strictObject({ ticketId: z.string().regex(/^SUP-\d+$/) }),
  get_user: z.strictObject({ userId: z.string().min(1).max(100) }),
  list_user_tickets: z.strictObject({ userId: z.string().min(1).max(100) }),
  search_knowledge: z.strictObject({ query: z.string().trim().min(1).max(1000), limit: z.number().int().min(1).max(6).optional() }),
};

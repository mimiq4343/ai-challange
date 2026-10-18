import { z } from "zod";
import { FILE_ASSISTANT_CONFIG as CONFIG } from "./file-assistant-config";
import { projectPathSchema, projectToolSchemas } from "./project-tool-schemas";

export class FileAssistantError extends Error {
  constructor(message: string, readonly status = 400, options?: ErrorOptions) {
    super(message, options);
    this.name = "FileAssistantError";
  }
}

export const fileProposalSchema = z.object({
  id: z.uuid(), path: z.string(), patch: z.string(),
  baseHash: z.string().nullable(), status: z.enum(["pending", "applied"]),
  createdAt: z.string(), expiresAt: z.string(),
});
export type FileProposal = z.infer<typeof fileProposalSchema>;
export type FileEdit = { oldText: string; newText: string };

export const fileToolSchemas = {
  git_branch: projectToolSchemas.git_branch,
  git_status: projectToolSchemas.git_status,
  list_files: projectToolSchemas.list_files,
  read_file: z.strictObject({
    path: projectPathSchema.min(1),
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
  }),
  search_files: z.strictObject({
    query: z.string().min(1).max(200).regex(/^[^\p{Cc}]+$/u),
    path: projectPathSchema.optional(),
  }),
  propose_file: z.strictObject({
    path: projectPathSchema.min(1),
    baseHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    content: z.string().min(1).max(CONFIG.maxContentCharacters).optional(),
    edits: z.array(z.strictObject({ oldText: z.string().min(1).max(10_000), newText: z.string().max(20_000) })).min(1).max(10).optional(),
  }).refine(input => (input.content !== undefined) !== (input.edits !== undefined), "Передайте только content или только edits"),
};

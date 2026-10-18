import { z } from "zod";
import { fileProposalSchema } from "./file-assistant-types";

export class ReleaseError extends Error {
  constructor(message: string, readonly status = 400, options?: ErrorOptions) { super(message, options); this.name = "ReleaseError"; }
}

const sha = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
export const releaseWorkspaceSchema = z.object({
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  branches: z.array(z.object({ ref: z.string(), label: z.string(), sha })), baseRef: z.string(), headRef: z.string(),
});
export type ReleaseWorkspace = z.infer<typeof releaseWorkspaceSchema>;

export const releaseSnapshotSchema = z.object({
  repository: releaseWorkspaceSchema.shape.repository, baseRef: z.string(), headRef: z.string(), baseSha: sha, headSha: sha,
  totalFiles: z.number().int().nonnegative(), commitsTruncated: z.boolean(),
  commits: z.array(z.object({ id: z.string().regex(/^C\d+$/), sha, subject: z.string() })),
  files: z.array(z.object({ id: z.string().regex(/^F\d+$/), path: z.string(), status: z.string(), patch: z.string(),
    side: z.enum(["base", "head"]), line: z.number().int().positive().nullable() })),
  skipped: z.array(z.object({ path: z.string(), reason: z.string() })),
});
export type ReleaseSnapshot = z.infer<typeof releaseSnapshotSchema>;

export const releaseCiSchema = z.object({
  state: z.enum(["success", "failed", "pending", "missing", "unavailable", "partial"]), message: z.string(), checkedAt: z.string(),
  runs: z.array(z.object({ id: z.number().int().positive(), name: z.string(), url: z.url(), status: z.string(), conclusion: z.string().nullable() })),
});
export type ReleaseCi = z.infer<typeof releaseCiSchema>;
const item = z.strictObject({ text: z.string().trim().min(1).max(1_000), sourceIds: z.array(z.string().regex(/^[FC]\d+$/)).min(1).max(8) });
export const releaseAnalysisSchema = z.strictObject({
  features: z.array(item).max(10), fixes: z.array(item).max(10), other: z.array(item).max(10), risks: z.array(item).max(10), checks: z.array(item).max(10),
  limitations: z.array(z.string().trim().min(1).max(600)).max(8),
});
export type ReleaseAnalysis = z.infer<typeof releaseAnalysisSchema>;
export const releaseReportSchema = z.object({
  snapshot: releaseSnapshotSchema, ci: releaseCiSchema, analysis: releaseAnalysisSchema, model: z.string(), markdown: z.string(),
  createdAt: z.string(), proposal: fileProposalSchema.nullable(), proposalError: z.string().nullable(),
});
export type ReleaseReport = z.infer<typeof releaseReportSchema>;
export const releaseEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("progress"), message: z.string() }),
  z.object({ type: z.literal("snapshot"), snapshot: releaseSnapshotSchema }),
  z.object({ type: z.literal("ci"), ci: releaseCiSchema }),
  z.object({ type: z.literal("result"), report: releaseReportSchema }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ReleaseEvent = z.infer<typeof releaseEventSchema>;

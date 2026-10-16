import * as z from "zod/v4";
import { PROJECT_MCP_LIMITS as LIMITS } from "./dev-assistant-config";

// Путь относительно корня репозитория: без абсолютных путей, «..», pathspec-магии
// и управляющих символов. Git дополнительно получает --literal-pathspecs.
export const projectPathSchema = z.string().trim().max(LIMITS.maxPathCharacters)
  .regex(/^[^\p{Cc}\\]*$/u, "Путь не должен содержать управляющие символы и обратный слэш")
  .refine((value) => !value.startsWith("/") && !value.startsWith(":") && !value.startsWith("-"), "Ожидается относительный путь внутри репозитория")
  .refine((value) => !value.split("/").includes(".."), "Путь не должен выходить за пределы репозитория");

export function normalizeProjectPath(value: string | undefined): string {
  return (value ?? "").trim().replace(/^\.(?:\/|$)/, "").replace(/\/+$/, "");
}

export const projectToolSchemas = {
  search_docs: z.strictObject({
    query: z.string().trim().min(1).max(LIMITS.maxQueryCharacters)
      .regex(/^[^\p{Cc}]+$/u, "Запрос не должен содержать управляющие символы")
      .describe("Поисковый запрос по документации проекта на естественном языке"),
    limit: z.number().int().min(1).max(LIMITS.maxSearchK).optional()
      .describe(`Число фрагментов, по умолчанию ${LIMITS.defaultSearchK}`),
  }),
  git_branch: z.strictObject({}),
  git_status: z.strictObject({}),
  list_files: z.strictObject({
    path: projectPathSchema.optional().describe("Каталог относительно корня репозитория; пусто — корень"),
  }),
  git_diff: z.strictObject({
    path: projectPathSchema.optional().describe("Файл или каталог для ограничения diff; пусто — весь репозиторий"),
  }),
};

export type ProjectToolName = keyof typeof projectToolSchemas;

const fileStatus = z.object({
  path: z.string(),
  kind: z.enum(["changed", "renamed", "unmerged", "untracked"]),
  index: z.string(),
  worktree: z.string(),
  from: z.string().optional(),
});

export const projectToolOutputSchemas = {
  search_docs: z.object({
    indexId: z.string(),
    stale: z.boolean(),
    results: z.array(z.object({
      id: z.string(), source: z.string(), section: z.string(),
      startLine: z.number().int(), endLine: z.number().int(), score: z.number(), text: z.string(),
    })),
  }),
  git_branch: z.object({
    branch: z.string().nullable(),
    detached: z.boolean(),
    head: z.string().nullable(),
    upstream: z.string().nullable(),
    ahead: z.number().int().nullable(),
    behind: z.number().int().nullable(),
    lastCommit: z.object({ subject: z.string(), committedAt: z.string() }).nullable(),
  }),
  git_status: z.object({
    branch: z.string().nullable(),
    clean: z.boolean(),
    total: z.number().int(),
    truncated: z.boolean(),
    files: z.array(fileStatus),
  }),
  list_files: z.object({
    path: z.string(),
    totalFiles: z.number().int(),
    truncated: z.boolean(),
    entries: z.array(z.object({ name: z.string(), type: z.enum(["directory", "file"]), files: z.number().int() })),
  }),
  git_diff: z.object({
    base: z.literal("HEAD"),
    path: z.string(),
    stat: z.string(),
    patch: z.string(),
    truncated: z.boolean(),
  }),
} satisfies Record<ProjectToolName, z.ZodType>;

export type ProjectToolOutput<Name extends ProjectToolName> = z.infer<(typeof projectToolOutputSchemas)[Name]>;
export type ProjectFileStatus = z.infer<typeof fileStatus>;
export type DocsSearchResult = ProjectToolOutput<"search_docs">["results"][number];

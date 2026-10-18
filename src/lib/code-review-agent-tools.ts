import "server-only";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CodeReviewError } from "./code-review-agent";
import { reviewToolSchemas } from "./code-review-agent-config";
import { collectReviewSnapshot } from "./code-review-git";
import { CodeReviewGithubError } from "./code-review-github";
import { fetchReviewPullRequest, readReviewPullRequest } from "./code-review-pull-request";
import { analyzeReviewSnapshot } from "./code-review-runner";
import type { CodeReviewEvent, ReviewWorkspace } from "./code-review-types";
import type { McpToolSession } from "./mcp-client";

export type ReviewAgentContext = { workspace: ReviewWorkspace; selection: { baseRef: string; headRef: string } };
export type ReviewAgentOptions = { context: ReviewAgentContext; onEvent: (event: CodeReviewEvent) => void };

export async function withReviewAgentTools<T>(root: string, options: ReviewAgentOptions, signal: AbortSignal, operation: (session: Pick<McpToolSession, "tools" | "callTool">) => Promise<T>): Promise<T> {
  const { workspace } = options.context;
  let completed = false;
  const descriptions = { review_changes: "Ревью закоммиченных изменений между двумя известными ветками проекта: diff, полные файлы, RAG, баги, архитектура и рекомендации.",
    review_pr: "Ревью GitHub PR текущего репозитория по номеру: загрузка base/head без checkout, diff, файлы и RAG. Ничего не публикует в GitHub." };
  const emit = options.onEvent;
  return operation({
    tools: Object.entries(reviewToolSchemas).map(([name, schema]) => ({ name, description: descriptions[name as keyof typeof descriptions], inputSchema: z.toJSONSchema(schema, { io: "input", target: "draft-07" }) })),
    callTool: async (name, args): Promise<CallToolResult> => {
      signal.throwIfAborted();
      try {
        if (completed) throw new CodeReviewError("Ревью для этого запроса уже выполнено. Отчёт показан в интерфейсе.");
        let baseSha: string; let headSha: string;
        if (name === "review_changes") {
          const input = reviewToolSchemas.review_changes.parse(args);
          const base = workspace.branches.find(branch => branch.ref === input.baseRef);
          const head = workspace.branches.find(branch => branch.ref === input.headRef);
          if (!base || !head) throw new CodeReviewError("Ветка не найдена. Используйте точные refs из списка проекта.");
          baseSha = base.sha; headSha = head.sha;
        } else if (name === "review_pr") {
          const input = reviewToolSchemas.review_pr.parse(args);
          if (input.repository.toLowerCase() !== workspace.repository.toLowerCase()) throw new CodeReviewError("Ревью доступно только для текущего репозитория проекта.");
          emit({ type: "progress", message: `Получаю PR #${input.number} из ${workspace.repository}…` });
          const pr = await readReviewPullRequest(workspace.repository, input.number, signal, process.env.GITHUB_TOKEN);
          await fetchReviewPullRequest(root, pr, signal, process.env.GITHUB_TOKEN);
          baseSha = pr.baseSha; headSha = pr.headSha;
        } else { throw new CodeReviewError("Неизвестный инструмент ревью."); }
        emit({ type: "progress", message: "Собираю diff и изменённые файлы…" });
        const snapshot = await collectReviewSnapshot(root, baseSha, headSha, signal);
        emit({ type: "snapshot", snapshot });
        const report = await analyzeReviewSnapshot(root, snapshot, signal, message => emit({ type: "progress", message }));
        signal.throwIfAborted();
        emit({ type: "result", report });
        completed = true;
        const counts = { bug: 0, architecture: 0, recommendation: 0 };
        for (const review of report.reviews) for (const finding of review.findings) counts[finding.category]++;
        const unreviewed = snapshot.skipped.length + snapshot.files.length - report.reviews.length;
        const summary = { status: unreviewed ? "partial" : "complete", baseSha, headSha, totalFiles: snapshot.totalFiles,
          reviewedFiles: report.reviews.length, unreviewedFiles: unreviewed, findings: counts,
          report: "Полный отчёт, diff и RAG-источники показаны в интерфейсе. Не переписывай их." };
        return { content: [{ type: "text", text: JSON.stringify(summary) }], structuredContent: summary, isError: false };
      } catch (cause) {
        signal.throwIfAborted();
        const known = cause instanceof CodeReviewError || cause instanceof CodeReviewGithubError;
        if (!known) console.error("code_review_agent_tool_failed", { tool: name, error: cause instanceof Error ? cause.name : "UnknownError" });
        return { content: [{ type: "text", text: known ? cause.message : "Не удалось выполнить ревью. Проверьте Git и доступ к модели." }], isError: true };
      }
    },
  });
}

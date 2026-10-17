import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ChatAgent } from "../src/lib/chat-agent";
import { CodeReviewError, renderCodeReview, reviewSnapshot } from "../src/lib/code-review-agent";
import { CODE_REVIEW_CONFIG as CONFIG, CODE_REVIEW_INDEX_CONFIG } from "../src/lib/code-review-config";
import { collectReviewSnapshot, fetchReviewHead } from "../src/lib/code-review-git";
import { CodeReviewGithubError, parseReviewEvent, publishReviewComment, type ReviewEvent } from "../src/lib/code-review-github";
import { buildReviewIndex, readReviewIndex, retrieveReviewContext } from "../src/lib/code-review-rag";
import type { CodeReviewReport } from "../src/lib/code-review-types";
import { LocalDocumentEmbeddingClient } from "../src/lib/local-document-embeddings";
import { RAG_EMBEDDING_CONFIG } from "../src/lib/rag-embedding-config";
import { prepareRagModel } from "../src/lib/rag-model-download";

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { event: { type: "string" }, base: { type: "string" }, head: { type: "string" }, repository: { type: "string" } } });
  if (values.event ? values.base || values.head : !values.base || !values.head) {
    throw new CodeReviewError("Укажите либо --event <path>, либо --base <SHA> --head <SHA>.");
  }
  const repository = values.repository ?? process.env.GITHUB_REPOSITORY;
  if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new CodeReviewError("Укажите --repository owner/repo или GITHUB_REPOSITORY.");
  }
  let event: ReviewEvent | undefined;
  if (values.event) {
    event = parseReviewEvent(JSON.parse(await readFile(values.event, "utf8")), repository);
    if (!process.env.GITHUB_TOKEN) throw new CodeReviewError("Для режима --event нужен GITHUB_TOKEN.");
  }
  const baseSha = event?.baseSha ?? values.base!;
  const headSha = event?.headSha ?? values.head!;
  const root = process.cwd();
  const output = resolve(root, CONFIG.outputDirectory);
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("AI-ревью прервано."));
  process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
  let indexRoot: string | undefined;
  let markdown: string;
  let failed = false;
  let report: CodeReviewReport | undefined;
  await mkdir(output, { recursive: true });
  try {
    try {
      if (event) await fetchReviewHead(root, event.number, headSha, process.env.GITHUB_TOKEN!, controller.signal);
      const snapshot = await collectReviewSnapshot(root, baseSha, headSha, controller.signal);
      console.log(`PR: ${snapshot.totalFiles} изменений, ${snapshot.files.length} файлов для LLM, ${snapshot.skipped.length} пропущено.`);
      if (!snapshot.files.length) {
        report = { model: CONFIG.model, indexId: null, snapshot, reviews: [] };
      } else {
        if (!process.env.OPENAI_BASE_URL || !process.env.OPENAI_API_KEY) {
          throw new CodeReviewError("Не заданы OPENAI_BASE_URL и/или OPENAI_API_KEY. Настройте Actions Variable и Secret по docs/code-review.md.");
        }
        const llm = ChatAgent.fromEnvironment({ ...process.env, OPENAI_MODEL: CONFIG.model });
        await prepareRagModel(root, controller.signal, console.log);
        indexRoot = await mkdtemp(join(tmpdir(), "flash-ai-review-"));
        const client = new LocalDocumentEmbeddingClient(resolve(root, RAG_EMBEDDING_CONFIG.modelPath));
        await buildReviewIndex({ root, baseSha, indexRoot, client, signal: controller.signal, onProgress: console.log });
        const index = readReviewIndex(join(indexRoot, CODE_REVIEW_INDEX_CONFIG.databasePath), baseSha);
        report = await reviewSnapshot({ snapshot, indexId: index.id, llm,
          retrieve: (file, signal) => retrieveReviewContext(index, client, file, signal),
          signal: controller.signal, onProgress: console.log,
          onFailure: (path, reason) => console.error(JSON.stringify({ level: "error", event: "file_review_failed", path, reason })),
        });
      }
      await writeFile(join(output, "review.json"), `${JSON.stringify(report, null, 2)}\n`);
      markdown = renderCodeReview(report, repository);
      failed = report.reviews.length < snapshot.files.length;
    } catch (cause) {
      controller.signal.throwIfAborted();
      failed = true;
      const reason = cause instanceof CodeReviewError || cause instanceof CodeReviewGithubError ? cause.message : "Не удалось собрать контекст PR или выполнить ревью. Проверьте Git, доступ к модели и лог запуска.";
      console.error(JSON.stringify({ level: "error", event: "review_failed", reason }));
      markdown = `${CONFIG.commentMarker}\n## AI-ревью кода · Day 32\n\nРевью коммита \`${headSha}\` не выполнено.\n\n${reason}\n`;
      await writeFile(join(output, "review.json"), `${JSON.stringify({ status: "failed", baseSha, headSha, reason, ...(report ? { report } : {}) }, null, 2)}\n`);
    }
    await writeFile(join(output, "review.md"), markdown);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
    if (event) {
      const status = await publishReviewComment(event, markdown, process.env.GITHUB_TOKEN!, fetch, controller.signal);
      console.log(`Комментарий PR: ${status}.`);
    }
    console.log(`Отчёт: ${join(output, "review.md")}`);
    if (failed) process.exitCode = 1;
  } finally {
    if (indexRoot) await rm(indexRoot, { recursive: true, force: true });
    process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel);
  }
}

main().catch((cause: unknown) => {
  const reason = cause instanceof CodeReviewError || cause instanceof CodeReviewGithubError ? cause.message : "AI-ревью завершилось ошибкой. Проверьте аргументы, событие PR и доступ к GitHub.";
  console.error(JSON.stringify({ level: "error", event: "review_cli_failed", reason }));
  process.exitCode = 1;
});

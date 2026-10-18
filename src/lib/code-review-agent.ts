import { z } from "zod";
import { CODE_REVIEW_CONFIG as CONFIG, CODE_REVIEW_PROMPT } from "./code-review-config";
import type { CodeReviewReport, FileReview, ReviewFile, ReviewSnapshot, ReviewSource } from "./code-review-types";
import type { CompressionLlmResponder } from "./compression-llm";

const responseSchema = z.object({
  findings: z.array(z.object({
    category: z.enum(["bug", "architecture", "recommendation"]), severity: z.enum(["high", "medium", "low"]),
    line: z.number().int().positive().nullable(), title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(4_000), recommendation: z.string().trim().min(1).max(2_000),
    sourceIds: z.array(z.string().regex(/^S\d+$/)).max(CONFIG.docsTopK + CONFIG.codeTopK),
  }).strict()).max(CONFIG.maxFindingsPerFile),
  limitations: z.array(z.string().trim().min(1).max(600)).max(8),
}).strict();

export class CodeReviewError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = "CodeReviewError"; }
}

export function parseFileReview(text: string, file: ReviewFile, sources: ReviewSource[]): FileReview {
  if (text.length > CONFIG.maxAnswerCharacters) throw new CodeReviewError("Ответ ревью превышает лимит.");
  let result: z.infer<typeof responseSchema>;
  try { result = responseSchema.parse(JSON.parse(text)); }
  catch (cause) { throw new CodeReviewError("Ответ ревью не соответствует JSON-контракту.", { cause }); }
  const ids = new Set(sources.map((source) => source.id));
  const lines = new Set(file.changedLines);
  for (const finding of result.findings) {
    if (finding.line === null ? lines.size > 0 : !lines.has(finding.line)) throw new CodeReviewError("Замечание ссылается на строку вне допустимых якорей изменений.");
    if (finding.sourceIds.some((id) => !ids.has(id))) throw new CodeReviewError("Замечание содержит неизвестный RAG-источник.");
  }
  return { path: file.path, side: file.side, ...result, sources };
}

export async function reviewSnapshot(options: {
  snapshot: ReviewSnapshot; indexId: string | null; llm: CompressionLlmResponder;
  retrieve: (file: ReviewFile, signal: AbortSignal) => Promise<ReviewSource[]>;
  signal: AbortSignal; onFailure?: (path: string, reason: string) => void;
  onProgress?: (message: string) => void;
}): Promise<CodeReviewReport> {
  const { llm, retrieve, signal, onFailure, onProgress } = options;
  const snapshot = { ...options.snapshot, skipped: [...options.snapshot.skipped] };
  const reviews: FileReview[] = [];
  for (const file of snapshot.files) {
    signal.throwIfAborted();
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(CONFIG.requestTimeoutMs)]);
    onProgress?.(`Ревью: ${file.path}`);
    try {
      const sources = await retrieve(file, requestSignal);
      const response = await llm.respond([{ role: "user", content: JSON.stringify({
        BASE_SHA: snapshot.baseSha, HEAD_SHA: snapshot.headSha, PR_FILE: file, CONTEXT: sources,
        PR_CHANGES: snapshot.files.map(({ path, side, status, patch }) => ({ path, side, status, patch })),
        UNREVIEWED_FILES: snapshot.skipped,
      }) }], requestSignal, { systemMessages: [CODE_REVIEW_PROMPT], maxOutputTokens: CONFIG.maxOutputTokens, strictStream: true });
      const text = await new Response(response.stream).text();
      requestSignal.throwIfAborted();
      if (await response.finishReason !== "stop") throw new CodeReviewError("LLM не завершила ревью полностью.");
      reviews.push(parseFileReview(text, file, sources));
    } catch (cause) {
      signal.throwIfAborted();
      // Ошибка одного файла не превращает его в «замечаний нет». Продолжаем
      // остальные файлы; сырой ответ провайдера может содержать секреты.
      const reason = cause instanceof CodeReviewError ? cause.message
        : requestSignal.aborted || (cause instanceof Error && cause.name === "TimeoutError")
          ? "Истёк таймаут ревью файла." : "Ошибка LLM или поиска RAG; файл не проверен.";
      snapshot.skipped.push({ path: file.path, reason });
      onFailure?.(file.path, reason);
    }
  }
  return { model: llm.model, indexId: options.indexId, snapshot, reviews };
}

function escapeMarkdown(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/@/g, "@\u200b").replace(/[\\`*_[\]#|]/g, "\\$&");
}

export function renderCodeReview(report: CodeReviewReport, repository: string): string {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("Некорректный репозиторий GitHub.");
  const { snapshot, reviews } = report;
  const total = reviews.reduce((count, review) => count + review.findings.length, 0);
  const link = (path: string, sha: string, line: number | null) => `https://github.com/${repository}/blob/${sha}/${path.split("/").map(encodeURIComponent).join("/")}${line === null ? "" : `#L${line}`}`;
  let text = `${CONFIG.commentMarker}\n## AI-ревью кода · Day 32\n\n`;
  text += `Коммит: \`${snapshot.headSha}\`. Проверено файлов: **${reviews.length}/${snapshot.totalFiles}**. Замечаний: **${total}**.\n\n`;
  text += report.indexId
    ? `Модель: ${escapeMarkdown(report.model)}. RAG: документация и код из base \`${snapshot.baseSha}\`.\n`
    : "LLM и RAG не запускались: нет файлов, подходящих для анализа.\n";
  const labels = { bug: "Потенциальные баги", architecture: "Архитектурные проблемы", recommendation: "Рекомендации" } as const;
  const severity = { high: "Высокая", medium: "Средняя", low: "Низкая" } as const;
  let omitted = 0;
  function appendBounded(entry: string, limit = CONFIG.maxCommentCharacters - CONFIG.commentFooterReserveCharacters): boolean {
    if (text.length + entry.length > limit) return false;
    text += entry;
    return true;
  }
  for (const category of ["bug", "architecture", "recommendation"] as const) {
    text += `\n### ${labels[category]}\n\n`;
    const findings = reviews.flatMap((review) => review.findings.filter((finding) => finding.category === category).map((finding) => ({ review, finding })));
    if (!findings.length) text += reviews.length ? "Замечаний этой категории в проверенных файлах нет.\n" : "Нет успешно проверенных файлов.\n";
    findings.sort((a, b) => ["high", "medium", "low"].indexOf(a.finding.severity) - ["high", "medium", "low"].indexOf(b.finding.severity));
    for (const { review, finding } of findings) {
      const sha = review.side === "base" ? snapshot.mergeBaseSha : snapshot.headSha;
      const location = finding.line === null ? escapeMarkdown(review.path) : `${escapeMarkdown(review.path)}:${finding.line}`;
      let entry = `- **${severity[finding.severity]} · ${escapeMarkdown(finding.title)}** — [${location}](${link(review.path, sha, finding.line)})`;
      if (review.side === "base") entry += " (версия base)";
      entry += `\n\n  ${escapeMarkdown(finding.body).replace(/\n/g, "\n  ")}\n\n  Исправление: ${escapeMarkdown(finding.recommendation).replace(/\n/g, "\n  ")}\n`;
      if (finding.sourceIds.length) entry += `\n  Основание: ${finding.sourceIds.map((id) => {
        const source = review.sources.find((source) => source.id === id)!;
        return `[${id}: ${escapeMarkdown(source.source)}:${source.startLine}](${link(source.source, snapshot.baseSha, source.startLine)})`;
      }).join(", ")}.\n`;
      if (!appendBounded(`${entry}\n`, CONFIG.maxFindingCommentCharacters)) omitted++;
    }
  }
  const limitations = reviews.flatMap((review) => review.limitations.map((limitation) => `${review.path}: ${limitation}`));
  let omittedSkipped = 0;
  let omittedLimitations = 0;
  if (snapshot.skipped.length) {
    text += "\n### Не проверены\n\n";
    for (const file of snapshot.skipped) {
      if (!appendBounded(`- ${escapeMarkdown(file.path)}: ${escapeMarkdown(file.reason)}\n`)) omittedSkipped++;
    }
  }
  if (limitations.length) {
    text += "\n### Ограничения анализа\n\n";
    for (const limitation of limitations) if (!appendBounded(`- ${escapeMarkdown(limitation)}\n`)) omittedLimitations++;
  }
  if (omitted || omittedSkipped || omittedLimitations) {
    text += `\nВ комментарий не поместились: ${omitted} замечаний, ${omittedSkipped} непроверенных файлов, ${omittedLimitations} ограничений. Полный отчёт — в JSON-артефакте Actions.\n`;
  }
  text += "\nРезультат относится к указанному коммиту и успешно проверенным файлам.\n";
  if (text.length > CONFIG.maxCommentCharacters) throw new CodeReviewError("Отчёт превышает лимит комментария GitHub; полный JSON сохранён в артефакте.");
  return text;
}

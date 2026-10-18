import "server-only";
import { ChatAgent } from "./chat-agent";
import type { CompressionLlmResponder } from "./compression-llm";
import { FILE_ASSISTANT_CONFIG } from "./file-assistant-config";
import { ProjectFiles } from "./file-assistant-files";
import { fileGit, readProjectText } from "./file-assistant-io";
import { FileAssistantError } from "./file-assistant-types";
import { readReleaseCi } from "./release-ci";
import { RELEASE_CONFIG as CONFIG, RELEASE_PROMPT } from "./release-config";
import { collectReleaseSnapshot, readReleaseWorkspace } from "./release-git";
import { ReleaseError, releaseAnalysisSchema, type ReleaseAnalysis, type ReleaseCi, type ReleaseEvent, type ReleaseReport, type ReleaseSnapshot } from "./release-types";

export function parseReleaseAnalysis(text: string, snapshot: ReleaseSnapshot): ReleaseAnalysis {
  if (text.length > CONFIG.maxAnswerCharacters) throw new ReleaseError("Ответ AI превышает допустимый объём.", 502);
  let analysis: ReleaseAnalysis;
  try { analysis = releaseAnalysisSchema.parse(JSON.parse(text)); }
  catch (cause) { throw new ReleaseError("Ответ AI не соответствует контракту отчёта релиза.", 502, { cause }); }
  const ids = new Set([...snapshot.files, ...snapshot.commits].map(source => source.id));
  for (const category of ["features", "fixes", "other", "risks", "checks"] as const) {
    for (const item of analysis[category]) {
      if (item.sourceIds.some(id => !ids.has(id))) throw new ReleaseError("AI сослался на неизвестный источник изменений.", 502);
      if (category !== "other" && !item.sourceIds.some(id => id.startsWith("F"))) throw new ReleaseError("Утверждение AI должно опираться на diff файла, а не только на название коммита.", 502);
    }
  }
  if (!analysis.features.length && !analysis.fixes.length && !analysis.other.length) throw new ReleaseError("AI не описал изменения релиза.", 502);
  if (!analysis.checks.length) throw new ReleaseError("AI не подготовил рекомендации по проверкам релиза.", 502);
  return analysis;
}

function escapeMarkdown(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/@/g, "@\u200b").replace(/[\\`*_[\]#|]/g, "\\$&").replace(/\r?\n/g, " ");
}

export function renderReleaseMarkdown(snapshot: ReleaseSnapshot, ci: ReleaseCi, analysis: ReleaseAnalysis, model: string, createdAt: string): string {
  const { repository, baseSha, headSha } = snapshot;
  const source = (id: string): string => {
    const file = snapshot.files.find(file => file.id === id);
    if (file) {
      const sha = file.side === "base" ? baseSha : headSha;
      const url = `https://github.com/${repository}/blob/${sha}/${file.path.split("/").map(encodeURIComponent).join("/")}${file.line === null ? "" : `#L${file.line}`}`;
      return `[${id}: ${escapeMarkdown(file.path)}](${url})`;
    }
    const commit = snapshot.commits.find(commit => commit.id === id);
    if (!commit) throw new ReleaseError("Источник отчёта отсутствует.", 502);
    return `[${id}: ${commit.sha.slice(0, 7)}](https://github.com/${repository}/commit/${commit.sha})`;
  };
  let text = `# Подготовка релиза · ${escapeMarkdown(repository)}\n\n`;
  text += `Диапазон: \`${baseSha}\` → \`${headSha}\`.\n\n`;
  text += `Сформировано: ${createdAt}. Модель: ${escapeMarkdown(model)}.\n\n`;
  text += `Проанализировано diff файлов: **${snapshot.files.length}/${snapshot.totalFiles}**. Коммитов в контексте: ${snapshot.commits.length}${snapshot.commitsTruncated ? " (список ограничен)" : ""}.\n`;
  const labels = { features: "Новые возможности", fixes: "Исправления", other: "Другие изменения", risks: "Риски и совместимость · оценка AI", checks: "Рекомендуемые проверки · не выполнялись этим сервисом" };
  for (const category of ["features", "fixes", "other", "risks", "checks"] as const) {
    text += `\n## ${labels[category]}\n\n`;
    if (!analysis[category].length) text += category === "risks" ? "AI не выделил рисков в доступном контексте. Совместимость не подтверждена.\n" : "AI не выделил изменений этой категории в доступном контексте.\n";
    for (const item of analysis[category]) text += `- ${category === "checks" ? "[ ] " : ""}${escapeMarkdown(item.text)} ${item.sourceIds.map(source).join(", ")}\n`;
  }
  text += `\n## GitHub Actions · фактические результаты\n\nSHA: \`${headSha}\`. Проверено: ${ci.checkedAt}.\n\n${escapeMarkdown(ci.message)}\n\n`;
  for (const run of ci.runs) text += `- [${escapeMarkdown(run.name)}](${run.url}): ${escapeMarkdown(run.status)} / ${escapeMarkdown(run.conclusion ?? "результат ещё не получен")}\n`;
  text += "\n## Ограничения\n\n- AI анализирует доступные diff и может ошибаться; ссылки подтверждают наличие источников, но не точность интерпретации.\n- Сервис не запускает тесты, не публикует релиз и не подтверждает готовность к выпуску.\n";
  if (snapshot.commitsTruncated) text += `- В контекст вошли только последние ${CONFIG.maxCommits} коммитов диапазона.\n`;
  for (const skipped of snapshot.skipped) text += `- Не проанализирован ${escapeMarkdown(skipped.path)}: ${escapeMarkdown(skipped.reason)}\n`;
  for (const limitation of analysis.limitations) text += `- ${escapeMarkdown(limitation)}\n`;
  return text;
}

export async function runRelease(root: string, input: { baseRef: string; headRef: string }, signal: AbortSignal, emit: (event: ReleaseEvent) => void,
  dependencies: { llm?: CompressionLlmResponder; fetcher?: typeof fetch } = {}): Promise<ReleaseReport> {
  signal.throwIfAborted();
  const checkout = fileGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  const checkoutHead = fileGit(root, ["rev-parse", "HEAD"]).trim();
  emit({ type: "progress", message: "Фиксирую коммиты и собираю реальные diff…" });
  const workspace = await readReleaseWorkspace(root, signal);
  const snapshot = await collectReleaseSnapshot(root, workspace, input.baseRef, input.headRef, signal);
  emit({ type: "snapshot", snapshot });
  if (!snapshot.files.length) throw new ReleaseError("Нет доступных текстовых diff для анализа. Исключённые файлы перечислены в снимке.");
  const llm = dependencies.llm ?? ChatAgent.fromEnvironment({ ...process.env, OPENAI_MODEL: CONFIG.model });
  emit({ type: "progress", message: "Получаю результаты GitHub Actions для SHA релиза…" });
  const ci = await readReleaseCi(workspace.repository, snapshot.headSha, signal, process.env.GITHUB_TOKEN, dependencies.fetcher);
  emit({ type: "ci", ci });
  emit({ type: "progress", message: "AI анализирует изменения, совместимость и необходимые проверки…" });
  const response = await llm.respond([{ role: "user", content: JSON.stringify({ RELEASE_SNAPSHOT: snapshot }) }], signal,
    { systemMessages: [RELEASE_PROMPT], maxOutputTokens: CONFIG.maxOutputTokens, strictStream: true });
  const text = await new Response(response.stream).text();
  signal.throwIfAborted();
  if (await response.finishReason !== "stop") throw new ReleaseError("AI не завершил ответ. Отчёт релиза не создан.", 502);
  const analysis = parseReleaseAnalysis(text, snapshot);
  const createdAt = new Date().toISOString();
  const markdown = renderReleaseMarkdown(snapshot, ci, analysis, llm.model, createdAt);
  const report: ReleaseReport = { snapshot, ci, analysis, markdown, model: llm.model, createdAt, proposal: null, proposalError: null };
  emit({ type: "progress", message: "Готовлю Markdown и diff для сохранения…" });
  if (markdown.length > FILE_ASSISTANT_CONFIG.maxContentCharacters || Buffer.byteLength(markdown) > FILE_ASSISTANT_CONFIG.maxFileBytes) {
    report.proposalError = "Markdown превышает лимит предложения файла. Скачайте полный отчёт или выберите меньший диапазон изменений.";
    return report;
  }
  try {
    if (fileGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim() !== checkout || fileGit(root, ["rev-parse", "HEAD"]).trim() !== checkoutHead) {
      throw new FileAssistantError("Рабочая ветка или HEAD изменились во время анализа. Повторите подготовку перед сохранением.", 409);
    }
    signal.throwIfAborted();
    const path = `${CONFIG.outputDirectory}/${snapshot.baseSha.slice(0, 12)}-${snapshot.headSha}.md`;
    const files = new ProjectFiles(root);
    const current = readProjectText(root, path);
    if (current) files.read(path);
    report.proposal = files.propose(path, current?.hash ?? null, markdown);
  } catch (cause) {
    signal.throwIfAborted();
    if (!(cause instanceof FileAssistantError)) throw cause;
    report.proposalError = cause.message;
  }
  return report;
}

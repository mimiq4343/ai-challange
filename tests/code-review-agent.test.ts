import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFileReview, reviewSnapshot, renderCodeReview } from "../src/lib/code-review-agent";
import type { ReviewFile, ReviewSource, ReviewSnapshot } from "../src/lib/code-review-types";
import type { CompressionLlmResponder } from "../src/lib/compression-llm";

const file: ReviewFile = { path: "src/store.ts", status: "M", side: "head", content: "save(user);\nsave(assistant);\n", patch: "+save(user);\n+save(assistant);", changedLines: [1, 2] };
const source: ReviewSource = { id: "S1", source: "docs/storage.md", section: "Storage", startLine: 2, endLine: 3, score: 0.8, text: "Save the whole exchange in one transaction." };
const finding = { category: "bug", severity: "high", line: 1, title: "Частичное сохранение", body: "Сбой второго save оставит user без ответа.", recommendation: "Сохранить обе записи одной транзакцией.", sourceIds: ["S1"] };
const snapshot: ReviewSnapshot = { baseSha: "a".repeat(40), headSha: "b".repeat(40), mergeBaseSha: "c".repeat(40), totalFiles: 1, files: [file], skipped: [] };

test("review findings must cite changed lines and existing RAG sources", () => {
  const review = parseFileReview(JSON.stringify({ findings: [finding], limitations: [] }), file, [source]);
  assert.equal(review.findings[0].recommendation, "Сохранить обе записи одной транзакцией.");
  for (const invalid of [{ ...finding, line: 99 }, { ...finding, sourceIds: ["S99"] }, { ...finding, category: "security" }]) {
    assert.throws(() => parseFileReview(JSON.stringify({ findings: [invalid], limitations: [] }), file, [source]));
  }
  assert.throws(() => parseFileReview("not JSON", file, [source]));
});

test("the model receives the actual diff, full changed file and retrieved context", async () => {
  const llm: CompressionLlmResponder = { model: "deepseek-v4-flash", async respond(messages, signal, options) {
    assert.equal(signal.aborted, false);
    assert.equal(options?.strictStream, true);
    const request = JSON.parse(messages[0].content);
    assert.equal(request.PR_FILE.patch, "+save(user);\n+save(assistant);");
    assert.equal(request.PR_FILE.content, "save(user);\nsave(assistant);\n");
    assert.deepEqual(request.PR_CHANGES, [{ path: "src/store.ts", side: "head", status: "M", patch: "+save(user);\n+save(assistant);" }]);
    assert.equal(request.CONTEXT[0].text, "Save the whole exchange in one transaction.");
    return {
      stream: new Response(JSON.stringify({ findings: [finding], limitations: [] })).body!,
      finishReason: Promise.resolve("stop"), usage: Promise.resolve(null),
    };
  } };
  const report = await reviewSnapshot({ snapshot, indexId: "idx", llm, retrieve: async () => [source], signal: AbortSignal.timeout(10_000) });
  assert.equal(report.reviews[0].findings[0].title, "Частичное сохранение");
  const markdown = renderCodeReview(report, "owner/repo");
  assert.match(markdown, /Потенциальные баги/);
  assert.match(markdown, /Архитектурные проблемы/);
  assert.match(markdown, /Рекомендации/);
  assert.ok(markdown.includes(`https://github.com/owner/repo/blob/${"b".repeat(40)}/src/store.ts#L1`));
  assert.ok(markdown.includes(`https://github.com/owner/repo/blob/${"a".repeat(40)}/docs/storage.md#L2`));
});

test("failed, timed out or incomplete LLM responses remain explicitly unreviewed", async () => {
  for (const failure of ["error", "length", "timeout"]) {
    const llm: CompressionLlmResponder = { model: "deepseek-v4-flash", async respond() {
      if (failure === "error") throw new Error("sensitive provider response");
      if (failure === "timeout") throw new DOMException("timed out", "TimeoutError");
      return { stream: new Response('{"findings":[],"limitations":[]}').body!, finishReason: Promise.resolve("length"), usage: Promise.resolve(null) };
    } };
    const report = await reviewSnapshot({ snapshot, indexId: "idx", llm, retrieve: async () => [source], signal: AbortSignal.timeout(10_000) });
    assert.equal(report.reviews.length, 0);
    assert.equal(report.snapshot.skipped.length, 1);
    const markdown = renderCodeReview(report, "owner/repo");
    assert.match(markdown, /Не проверены/);
    assert.equal(markdown.includes("sensitive provider response"), false);
  }
});

test("rendering escapes untrusted model text and uses the base side for deletions", () => {
  const review = parseFileReview(JSON.stringify({ findings: [{ ...finding, title: "@owner <script> [click](https://evil.example)" }], limitations: [] }), { ...file, side: "base" }, [source]);
  const markdown = renderCodeReview({ model: "test", indexId: "idx", snapshot, reviews: [review] }, "owner/repo");
  assert.equal(markdown.includes("@owner"), false);
  assert.equal(markdown.includes("<script>"), false);
  assert.equal(markdown.includes("[click](https://evil.example)"), false);
  assert.ok(markdown.includes(`https://github.com/owner/repo/blob/${"c".repeat(40)}/src/store.ts#L1`));
});

test("pure renames allow file-level findings without inventing an existing changed line", () => {
  const renamed = { ...file, path: "src/new-store.ts", previousPath: "src/store.ts", status: "R100", changedLines: [] };
  const review = parseFileReview(JSON.stringify({ findings: [{ ...finding, line: null }], limitations: [] }), renamed, [source]);
  const markdown = renderCodeReview({ model: "test", indexId: "idx", snapshot, reviews: [review] }, "owner/repo");
  assert.ok(markdown.includes(`https://github.com/owner/repo/blob/${snapshot.headSha}/src/new-store.ts)`));
  assert.equal(markdown.includes(":null"), false);
  assert.throws(() => parseFileReview(JSON.stringify({ findings: [{ ...finding, line: null }], limitations: [] }), file, [source]));
  assert.equal(parseFileReview(JSON.stringify({ findings: [{ ...finding, line: null }], limitations: [] }), { ...renamed, content: "" }, [source]).findings.length, 1);
});

test("long limitations and skipped-file lists fit the comment and retain the full report", () => {
  const reviews = Array.from({ length: 30 }, (_, i) => parseFileReview(JSON.stringify({
    findings: [], limitations: Array<string>(8).fill("Описание ограничения. ".repeat(15)),
  }), { ...file, path: `src/module${i}.ts` }, []));
  const skipped = Array.from({ length: 2_000 }, (_, i) => ({ path: `src/excluded${i}.ts`, reason: "Формат не поддерживается. ".repeat(10) }));
  const report = { model: "test", indexId: "idx", snapshot: { ...snapshot, totalFiles: 2_030, skipped }, reviews };
  const markdown = renderCodeReview(report, "owner/repo");
  assert.ok(markdown.length <= 60_000);
  assert.match(markdown, /Не проверены/);
  assert.match(markdown, /Ограничения анализа/);
  assert.match(markdown, /не поместил/);
  assert.match(markdown, /Полный отчёт/);
  assert.equal(report.reviews[29].limitations.length, 8);
  assert.equal(report.snapshot.skipped.length, 2_000);
});

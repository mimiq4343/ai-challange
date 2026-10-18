import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildReviewIndex, readReviewIndex, retrieveReviewContext } from "../src/lib/code-review-rag";
import { CODE_REVIEW_INDEX_CONFIG as CONFIG } from "../src/lib/code-review-config";

test("review retrieval loads a persisted base-SHA index and includes both docs and related code", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "flash-review-rag-"));
  const indexRoot = await mkdtemp(join(tmpdir(), "flash-review-index-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(indexRoot, { recursive: true, force: true }); });
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  git("init", "-q"); git("config", "user.email", "test@example.com"); git("config", "user.name", "Test");
  await mkdir(join(root, "src"));
  await writeFile(join(root, "README.md"), "# Storage\nSave the exchange in one transaction.\n");
  await writeFile(join(root, "src/store.ts"), "import { transaction } from './db';\nexport function saveExchange() { return 'transaction'; }\n");
  await writeFile(join(root, "src/db.ts"), "export const transaction = true;\n");
  await writeFile(join(root, "src/view.tsx"), "export const View = () => <p>Exchange</p>;\n");
  git("add", "."); git("commit", "-qm", "base");
  const baseSha = git("rev-parse", "HEAD");
  const client = {
    async countTokens(text: string) { return Math.ceil(text.length / 4); },
    async embed(texts: readonly string[]) {
      return { vectors: texts.map((text) => [text.includes("transaction") ? 1 : 0.1, 1, ...Array<number>(382).fill(0)]), tokens: texts.length * 20 };
    },
  };
  const built = await buildReviewIndex({ root, baseSha, indexRoot, client });
  const index = readReviewIndex(join(indexRoot, CONFIG.databasePath), baseSha);
  assert.equal(index.id, built.id);
  assert.ok(index.chunks.some((chunk) => chunk.source === "src/view.tsx"));
  const sources = await retrieveReviewContext(index, client, {
    path: "src/changed.ts", status: "M", side: "head", content: "", patch: "+saveExchange transaction", changedLines: [1],
  }, AbortSignal.timeout(10_000));
  assert.ok(sources.some((source) => source.source === "README.md" && source.text.includes("one transaction")));
  assert.ok(sources.some((source) => source.source === "src/store.ts"));
  assert.ok(sources.filter((source) => source.source.endsWith(".ts")).every((source) => source.text.includes("export")), "Code context must contain implementations rather than import-only chunks");
  const renameSources = await retrieveReviewContext(index, client, {
    path: "src/new-db.ts", previousPath: "src/db.ts", status: "R100", side: "head", content: "", patch: "rename from src/db.ts", changedLines: [],
  }, AbortSignal.timeout(10_000));
  assert.ok(renameSources.some((source) => source.section === "ImportDeclaration"), "Renames need import dependencies from the old path");
  assert.deepEqual(sources.map((source) => source.id), sources.map((_, i) => `S${i + 1}`));
  assert.throws(() => readReviewIndex(join(indexRoot, CONFIG.databasePath), "a".repeat(40)), /SHA/);
  const aborted = new AbortController();
  aborted.abort(new Error("cancel indexing"));
  await assert.rejects(buildReviewIndex({ root, baseSha, indexRoot, client, signal: aborted.signal }), /cancel indexing/);
  assert.equal(readReviewIndex(join(indexRoot, CONFIG.databasePath), baseSha).id, index.id);
});

test("cancellation during CPU tokenization is observed before embeddings and index publication", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "flash-review-yield-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  git("init", "-q"); git("config", "user.email", "test@example.com"); git("config", "user.name", "Test");
  await mkdir(join(root, "src"));
  await writeFile(join(root, "README.md"), `# Project\n${"long documentation paragraph ".repeat(2_000)}\n`);
  await writeFile(join(root, "src/store.ts"), "export const value = 1;\n");
  git("add", "."); git("commit", "-qm", "base");
  const controller = new AbortController();
  let scheduled = false;
  const client = {
    async countTokens(text: string) {
      if (!scheduled) { scheduled = true; setImmediate(() => controller.abort(new Error("cancel-during-tokenization"))); }
      return Math.ceil(text.length / 4);
    },
    async embed(texts: readonly string[]) {
      return { vectors: texts.map(() => [1, ...Array<number>(383).fill(0)]), tokens: 1 };
    },
  };
  await assert.rejects(buildReviewIndex({ root, baseSha: git("rev-parse", "HEAD"), indexRoot: root, client, signal: controller.signal }), /cancel-during-tokenization/);
  assert.throws(() => readReviewIndex(join(root, CONFIG.databasePath), git("rev-parse", "HEAD")));
});

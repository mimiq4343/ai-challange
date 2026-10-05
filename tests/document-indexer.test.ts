import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { indexDocuments } from "../src/lib/document-indexer";
import { SqliteDocumentStore } from "../src/lib/document-store";
import type { RetrievalQuestion } from "../src/lib/document-types";

const questions: RetrievalQuestion[] = [{ id: "storage", question: "Как сохранять данные?", source: "guide.md", section: "Storage", evidence: "transaction" }];
const vector = [1, ...Array<number>(2047).fill(0)];

test("the complete pipeline persists both strategies, real metadata and query evaluation", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "flash-document-indexer-"));
  const store = new SqliteDocumentStore(join(root, "index.sqlite"));
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  await writeFile(join(root, "guide.md"), "# Guide\nIntro.\n## Storage\nAtomic transaction.\n");
  const calls: string[] = [];
  const client = { async embed(inputs: readonly string[], kind: "search_document" | "search_query") {
    calls.push(kind); return { vectors: inputs.map(() => vector), tokens: inputs.length * 10 };
  } };
  const report = await indexDocuments({ root, store, client, sources: ["guide.md"], questions });
  assert.deepEqual(calls, ["search_document", "search_document", "search_query"]);
  assert.equal(report.providerRequests, 3);
  assert.equal(report.providerTokens, 40);
  assert.equal(report.corpus.files, 1);
  assert.deepEqual(report.comparison.map((item) => [item.strategy, item.chunks, item.hitRateAt5]), [["fixed", 1, 1], ["structural", 2, 1]]);
  assert.equal(store.latestReport()!.id, report.id);
  assert.equal(store.readVectors("structural")[1].section, "Guide / Storage");
  assert.equal(store.readVectors("fixed")[0].embedding.length, 2048);
  assert.equal(JSON.parse(await readFile(join(root, "data/documents-comparison.json"), "utf8")).id, report.id);
});

test("concurrent runs are excluded until both the index and JSON export are complete", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "flash-document-lock-"));
  const store = new SqliteDocumentStore(join(root, "index.sqlite"));
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  await writeFile(join(root, "guide.md"), "# Guide\n## Storage\ntransaction\n");
  let checked = false;
  const secondClient = { async embed(): Promise<never> { throw new Error("A second run reached the provider."); } };
  const client = { async embed(inputs: readonly string[]) {
    if (!checked) {
      checked = true;
      await assert.rejects(indexDocuments({ root, store, client: secondClient, sources: ["guide.md"], questions }), /уже выполняется/);
    }
    return { vectors: inputs.map(() => vector), tokens: 10 };
  } };
  await indexDocuments({ root, store, client, sources: ["guide.md"], questions });
  const next = await indexDocuments({ root, store, client, sources: ["guide.md"], questions });
  assert.equal(store.latestReport()!.id, next.id);
  assert.equal(JSON.parse(await readFile(join(root, "data/documents-comparison.json"), "utf8")).id, next.id);
});

test("a failed or cancelled indexing run preserves the previous completed index", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "flash-document-indexer-"));
  const store = new SqliteDocumentStore(join(root, "index.sqlite"));
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  await writeFile(join(root, "guide.md"), "# Guide\n## Storage\ntransaction\n");
  const valid = { async embed(inputs: readonly string[]) { return { vectors: inputs.map(() => vector), tokens: 10 }; } };
  const first = await indexDocuments({ root, store, client: valid, sources: ["guide.md"], questions });
  let calls = 0;
  const failing = { async embed(inputs: readonly string[]) {
    if (++calls === 2) throw new Error("provider unavailable");
    return { vectors: inputs.map(() => vector), tokens: 10 };
  } };
  await assert.rejects(indexDocuments({ root, store, client: failing, sources: ["guide.md"], questions }), /provider unavailable/);
  assert.equal(store.latestReport()!.id, first.id);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(indexDocuments({ root, store, client: valid, sources: ["guide.md"], questions, signal: abort.signal }));
  assert.equal(store.latestReport()!.id, first.id);
  await assert.rejects(indexDocuments({ root, store, client: valid, sources: ["guide.md"], questions: [{ ...questions[0], evidence: "missing" }] }), /не подтверждён/);
  assert.equal(store.latestReport()!.id, first.id);
});

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { documentChunksResponse } from "../src/lib/document-api";
import { indexDocuments } from "../src/lib/document-indexer";
import { SqliteDocumentStore } from "../src/lib/document-store";

test("chunk API validates filters and pages, reports an absent index and excludes embeddings", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "flash-document-api-"));
  const store = new SqliteDocumentStore(join(root, "index.sqlite"));
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  const request = (query: string) => new Request(`http://localhost/api/documents/chunks?${query}`);
  for (const query of ["", "strategy=bad", "strategy=fixed&offset=-1", "strategy=fixed&offset=NaN", "strategy=fixed&offset=1.5", "strategy=fixed&offset=9007199254740992"]) {
    assert.equal(documentChunksResponse(request(query), store).status, 400);
  }
  assert.equal(documentChunksResponse(request("strategy=fixed"), store).status, 404);
  await writeFile(join(root, "guide.md"), "# Guide\nAtomic transaction.\n");
  const report = await indexDocuments({ root, store, sources: ["guide.md"], questions: [
    { id: "storage", question: "Как сохранять данные?", source: "guide.md", section: "Guide", evidence: "transaction" },
  ], client: { async embed(inputs) { return { vectors: inputs.map(() => [1, ...Array<number>(2047).fill(0)]), tokens: 10 }; } } });
  assert.equal(documentChunksResponse(request("strategy=fixed&source=missing.md"), store).status, 400);
  assert.equal(documentChunksResponse(request("strategy=fixed&indexId=old"), store).status, 409);
  const response = documentChunksResponse(request(`strategy=fixed&source=guide.md&indexId=${report.id}`), store);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.indexId, report.id);
  assert.equal(result.total, 1);
  assert.equal(result.chunks[0].source, "guide.md");
  assert.equal("embedding" in result.chunks[0], false);
  assert.deepEqual((await documentChunksResponse(request("strategy=structural&offset=20"), store).json()).chunks, []);
});

test("a concurrent index replacement cannot mix an old report with new chunks", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "flash-document-snapshot-"));
  const path = join(root, "index.sqlite");
  const store = new SqliteDocumentStore(path);
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  await writeFile(join(root, "guide.md"), "# Guide\ntransaction\n");
  const original = await indexDocuments({ root, store, sources: ["guide.md"], questions: [
    { id: "storage", question: "Как сохранять данные?", source: "guide.md", section: "Guide", evidence: "transaction" },
  ], client: { async embed(inputs) { return { vectors: inputs.map(() => [1, ...Array<number>(2047).fill(0)]), tokens: 10 }; } } });
  const writer = new DatabaseSync(path);
  const readReport = store.latestReport.bind(store);
  let replaced = false;
  store.latestReport = () => {
    const report = readReport();
    if (!replaced) {
      replaced = true;
      writer.exec("BEGIN IMMEDIATE");
      writer.prepare("UPDATE document_index SET report_json = ?").run(JSON.stringify({ ...original, id: "new-index" }));
      writer.exec("UPDATE document_chunks SET title = 'New version'");
      writer.exec("COMMIT");
    }
    return report;
  };
  try {
    const response = documentChunksResponse(new Request(`http://localhost/api/documents/chunks?strategy=fixed&indexId=${original.id}`), store);
    const page = await response.json();
    assert.equal(response.status, 200);
    assert.equal(page.indexId, original.id);
    assert.equal(page.chunks[0].title, "Guide");
    assert.equal(store.latestReport()!.id, "new-index");
  } finally {
    writer.close();
  }
});

test("RAG vector snapshots keep the report and vectors from the same committed index", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "flash-rag-snapshot-"));
  const path = join(root, "index.sqlite");
  const store = new SqliteDocumentStore(path);
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  await writeFile(join(root, "guide.md"), "# Guide\ntransaction\n");
  const original = await indexDocuments({ root, store, sources: ["guide.md"], questions: [
    { id: "storage", question: "Как сохранять?", source: "guide.md", section: "Guide", evidence: "transaction" },
  ], client: { async embed(inputs) { return { vectors: inputs.map(() => [1, ...Array<number>(2047).fill(0)]), tokens: 10 }; } } });
  const writer = new DatabaseSync(path);
  const readReport = store.latestReport.bind(store);
  let replaced = false;
  store.latestReport = () => {
    const report = readReport();
    if (!replaced) {
      replaced = true;
      writer.exec("BEGIN IMMEDIATE");
      writer.prepare("UPDATE document_index SET report_json = ?").run(JSON.stringify({ ...original, id: "new-index" }));
      writer.exec("UPDATE document_chunks SET text = 'changed'");
      writer.exec("COMMIT");
    }
    return report;
  };
  try {
    const snapshot = store.readIndexVectors("structural");
    assert.equal(snapshot.report!.id, original.id);
    assert.match(snapshot.chunks[0].text, /transaction/);
    assert.equal(snapshot.chunks[0].embedding.length, 2048);
    assert.equal(store.latestReport()!.id, "new-index");
  } finally { writer.close(); }
});

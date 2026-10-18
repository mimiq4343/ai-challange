import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SUPPORT_INDEX_CONFIG as CONFIG } from "../src/lib/support-config";
import { createKnowledgeSearch } from "../src/lib/support-knowledge";
import { indexDocuments } from "../src/lib/document-indexer";
import { SqliteDocumentStore } from "../src/lib/document-store";

test("knowledge search rejects missing indexes, detects stale indexes and keeps provenance across multiple searches", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "support-knowledge-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const embedder = { async embed(inputs: readonly string[]) { return { tokens: inputs.length, vectors: inputs.map(text => {
    const vector = Array<number>(CONFIG.dimensions).fill(0);
    vector[text.includes("SQLite") ? 0 : text.includes("MCP") ? 1 : 2] = 1;
    return vector;
  }) }; } };
  const search = createKnowledgeSearch(root, embedder);
  await assert.rejects(search("SQLite", 4), /support:index/);
  await mkdir(join(root, "docs/support"), { recursive: true });
  await writeFile(join(root, "docs/support/faq.md"), "# SQLite\n\nИстория SQLite сохраняется после полного ответа.\n");
  await writeFile(join(root, "docs/support/troubleshooting.md"), "# MCP\n\nПроверьте права MCP у администратора.\n");
  const store = new SqliteDocumentStore(join(root, CONFIG.databasePath), CONFIG);
  try {
    await indexDocuments({ root, store, client: embedder, config: CONFIG, sources: ["docs/support/faq.md", "docs/support/troubleshooting.md"], countTokens: async text => text.length,
      questions: [{ id: "history", question: "SQLite", source: "docs/support/faq.md", section: "SQLite", evidence: "полного ответа" }] });
  } finally { store.close(); }
  const first = await search("SQLite", 4);
  assert.equal(first.stale, false);
  assert.equal(first.results[0].source, "docs/support/faq.md");
  const second = await search("MCP", 4);
  assert.ok(second.results.every(source => !first.results.some(previous => previous.id === source.id)));
  assert.deepEqual((await search("борщ", 4)).results, []);
  await writeFile(join(root, "docs/support/faq.md"), "# Изменённая инструкция\n");
  assert.equal((await search("SQLite", 4)).stale, true);
});

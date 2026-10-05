import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { chunkDocuments, documentSections } from "../src/lib/document-chunking";
import { countTextTokens } from "../src/lib/token-counter";
import type { CorpusDocument } from "../src/lib/document-types";

const countTokens = (text: string) => countTextTokens(text, "nemotron-3-embed-1b");

function document(source: string, text: string): CorpusDocument {
  return { source, title: source, text, sourceHash: createHash("sha256").update(text).digest("hex") };
}

test("Markdown sections ignore headings inside fenced code and preserve all source text", () => {
  const doc = document("guide.md", "# Guide\n\nIntroduction.\n\n## Storage\n```ts\n# not a heading\n```\nSaved text.\n\n## Retrieval\nResults.\n");
  const sections = documentSections(doc);
  assert.deepEqual(sections.map((section) => section.title), ["Guide", "Guide / Storage", "Guide / Retrieval"]);
  assert.equal(sections.map((section) => doc.text.slice(section.start, section.end)).join(""), doc.text);
});

test("TypeScript sections distinguish methods from braces and names inside strings", () => {
  const doc = document("store.ts", 'import fs from "node:fs";\nexport class Store {\n  save() { return "} fake() {"; }\n  load() { return fs; }\n}\nexport function run() { return new Store(); }\n');
  const sections = documentSections(doc);
  assert.ok(sections.some((section) => section.title === "Store.save"));
  assert.ok(sections.some((section) => section.title === "Store.load"));
  assert.ok(sections.some((section) => section.title === "run"));
  assert.equal(sections.map((section) => doc.text.slice(section.start, section.end)).join(""), doc.text);
});

test("fixed windows preserve Unicode, cover every character and stay within the model token budget", async () => {
  const doc = document("guide.md", "# Данные\n\n" + "Транзакция сохраняет сообщения атомарно. 🔥\n".repeat(12));
  const chunks = await chunkDocuments([doc], "fixed", countTokens, { maxTokens: 24, overlapTokens: 5 });
  assert.ok(chunks.length > 2);
  let covered = 0;
  for (const chunk of chunks) {
    assert.ok(chunk.start <= covered);
    assert.ok(chunk.end > covered);
    assert.equal(chunk.text, doc.text.slice(chunk.start, chunk.end));
    assert.doesNotMatch(chunk.text, /[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/);
    assert.ok(chunk.tokenCount <= 24);
    assert.equal(chunk.tokenCount, await countTokens(chunk.text));
    assert.ok(chunk.startLine > 0 && chunk.endLine >= chunk.startLine);
    covered = chunk.end;
  }
  assert.equal(covered, doc.text.length);
  assert.ok(chunks[1].start < chunks[0].end);
});

test("structural chunks never cross Markdown section boundaries and IDs are deterministic", async () => {
  const doc = document("guide.md", "# Guide\nFirst subject.\n\n## Storage\nAtomic transactions.\n\n## Retrieval\nSemantic search.\n");
  const chunks = await chunkDocuments([doc], "structural", countTokens);
  assert.deepEqual(chunks.map((chunk) => chunk.section), ["Guide", "Guide / Storage", "Guide / Retrieval"]);
  assert.equal(chunks.map((chunk) => chunk.text).join(""), doc.text);
  assert.deepEqual(await chunkDocuments([doc], "structural", countTokens), chunks);
  assert.equal(new Set(chunks.map((chunk) => chunk.chunkId)).size, chunks.length);
  const changed = document("guide.md", doc.text.replace("Atomic", "Safe"));
  const updated = await chunkDocuments([changed], "structural", countTokens);
  assert.notEqual(updated[1].chunkId, chunks[1].chunkId);
});

test("oversized structural sections are split without crossing into the next section", async () => {
  const doc = document("guide.md", "# Long\n" + "Atomic transactions preserve data.\n".repeat(15) + "\n## Next\nOther topic.\n");
  const chunks = await chunkDocuments([doc], "structural", countTokens, { maxTokens: 24, overlapTokens: 5 });
  const boundary = doc.text.indexOf("## Next");
  assert.ok(chunks.filter((chunk) => chunk.section === "Long").length > 1);
  assert.ok(chunks.filter((chunk) => chunk.section === "Long").every((chunk) => chunk.end <= boundary));
  assert.equal(chunks.at(-1)!.start, boundary);
  assert.equal(chunks.at(-1)!.section, "Long / Next");
});

test("invalid chunk budgets fail explicitly instead of losing text or looping", async () => {
  const doc = document("guide.md", "Text");
  for (const options of [{ maxTokens: 0, overlapTokens: 0 }, { maxTokens: 4, overlapTokens: 4 }, { maxTokens: 4, overlapTokens: -1 }]) {
    await assert.rejects(chunkDocuments([doc], "fixed", countTokens, options));
  }
});

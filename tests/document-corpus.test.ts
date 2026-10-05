import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadDocumentCorpus } from "../src/lib/document-corpus";

test("corpus loading preserves text and hashes, and uses only explicitly selected files", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "flash-documents-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "guide.md"), "\uFEFF# Руководство\r\nТекст.\r\n");
  await writeFile(join(directory, "secret.txt"), "not selected");
  const corpus = await loadDocumentCorpus(directory, ["guide.md"]);
  assert.equal(corpus.documents.length, 1);
  assert.equal(corpus.documents[0].text, "# Руководство\nТекст.\n");
  assert.equal(corpus.documents[0].title, "Руководство");
  assert.equal(corpus.characters, 21);
  assert.deepEqual(await loadDocumentCorpus(directory, ["guide.md"]), corpus);
  await writeFile(join(directory, "guide.md"), "# Changed\n");
  assert.notEqual((await loadDocumentCorpus(directory, ["guide.md"])).hash, corpus.hash);
});

test("missing, empty, duplicate and escaping corpus paths are rejected", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "flash-documents-"));
  const outside = await mkdtemp(join(tmpdir(), "flash-documents-outside-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); });
  await writeFile(join(directory, "guide.md"), "# Guide\nText\n");
  await writeFile(join(directory, "empty.md"), "  \n");
  await writeFile(join(outside, "private.md"), "not in corpus");
  await symlink(join(outside, "private.md"), join(directory, "link.md"));
  for (const paths of [["absent.md"], ["empty.md"], ["guide.md", "guide.md"], ["../private.md"], ["link.md"], []]) {
    await assert.rejects(loadDocumentCorpus(directory, paths));
  }
});

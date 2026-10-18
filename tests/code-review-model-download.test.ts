import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { RAG_EMBEDDING_CONFIG } from "../src/lib/rag-embedding-config";
import { prepareRagModel } from "../src/lib/rag-model-download";

test("concurrent first web reviews prepare the same model without deleting each other's download", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "flash-review-download-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = await readFile(resolve("tests/fixtures/e5-config.json"));
  assert.equal(createHash("sha256").update(config).digest("hex"), "cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1");
  const stop = new Error("fixture-stop-after-config");
  let arrivals = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    if (!String(url).endsWith("/config.json")) throw stop;
    if (++arrivals === 2) release();
    await barrier;
    let timer: ReturnType<typeof setTimeout>;
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) { timer = setTimeout(() => { controller.enqueue(config); controller.close(); }, 100); },
      cancel() { clearTimeout(timer); },
    }));
  });
  const results = await Promise.allSettled([prepareRagModel(root), prepareRagModel(root)]);
  for (const result of results) {
    assert.equal(result.status, "rejected");
    assert.equal(result.status === "rejected" && result.reason, stop);
  }
  const directory = join(root, RAG_EMBEDDING_CONFIG.modelPath);
  assert.deepEqual(await readFile(join(directory, "config.json")), config);
  assert.deepEqual(await readdir(directory), ["config.json"]);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { PIPELINE_LIMITS } from "../src/lib/pipeline-config";
import { readPipelineSummary } from "../src/lib/pipeline-summary";

const signal = new AbortController().signal;

test("summary reader preserves exact UTF8 including whitespace and split multibyte characters", async () => {
  const bytes = Buffer.from("  # Обзор\n\nТекст.\n");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  const result = await readPipelineSummary({ stream, usage: Promise.resolve(null), finishReason: Promise.resolve("stop") }, signal);
  assert.deepEqual(Buffer.from(result), bytes);
});

test("oversized, empty, invalid UTF8 and broken streams cannot become summaries", async () => {
  for (const chunk of [Buffer.from("я".repeat(7000)), Buffer.from("  \n"), Uint8Array.of(0xff)]) {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(chunk); controller.close(); } });
    await assert.rejects(readPipelineSummary({ stream, usage: Promise.resolve(null), finishReason: Promise.resolve("stop") }, signal));
  }
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("broken remote")); } });
  await assert.rejects(readPipelineSummary({ stream, usage: Promise.resolve(null), finishReason: Promise.resolve("stop") }, signal));
});

test("cancellation stops a hanging stream instead of saving partial Markdown", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(writer) { writer.enqueue(Buffer.from("# Незавершённый")); },
    cancel() { cancelled = true; },
  });
  const pending = assert.rejects(readPipelineSummary({ stream, usage: Promise.resolve(null), finishReason: Promise.resolve("stop") }, controller.signal));
  controller.abort(new Error("cancelled"));
  await pending;
  assert.equal(cancelled, true);
});

test("exact byte boundary is accepted only with a complete stop finish reason", async () => {
  const markdown = "a".repeat(PIPELINE_LIMITS.summaryMaxBytes);
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Buffer.from(markdown)); controller.close(); } });
  assert.equal(await readPipelineSummary({ stream, usage: Promise.resolve(null), finishReason: Promise.resolve("stop") }, signal), markdown);
});

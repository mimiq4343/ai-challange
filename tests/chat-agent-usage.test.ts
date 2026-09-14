import assert from "node:assert/strict";
import { test } from "node:test";

import { sseToChatResponse } from "../src/lib/chat-agent";

const encoder = new TextEncoder();

function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

test("streams text and resolves usage from the final split SSE event", async () => {
  const response = sseToChatResponse(
    sseBody([
      'data: {"choices":[{"delta":{"content":"При"}}]}\n',
      'data: {"choices":[{"delta":{"content":"вет"}}]}\n',
      'data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":8,',
      '"total_tokens":128,"prompt_cache_hit_tokens":80,"prompt_cache_miss_tokens":40}}\n',
      "data: [DONE]\n",
    ]),
  );

  assert.equal(await new Response(response.stream).text(), "Привет");
  assert.deepEqual(await response.usage, {
    promptTokens: 120,
    completionTokens: 8,
    totalTokens: 128,
    cacheHitTokens: 80,
    cacheMissTokens: 40,
  });
});

test("resolves null when clean stream omits or corrupts usage", async () => {
  const missing = sseToChatResponse(
    sseBody(['data: {"choices":[{"delta":{"content":"ok"}}]}\n']),
  );
  assert.equal(await new Response(missing.stream).text(), "ok");
  assert.equal(await missing.usage, null);

  const malformed = sseToChatResponse(
    sseBody([
      'data: {"choices":[{"delta":{"content":"still ok"}}],',
      '"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":99}}\n',
    ]),
  );
  assert.equal(await new Response(malformed.stream).text(), "still ok");
  assert.equal(await malformed.usage, null);
});

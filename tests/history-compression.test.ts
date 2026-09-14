import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSummaryRequest,
  selectCompressionWindow,
} from "../src/lib/history-compression";
import type { StoredMessage } from "../src/lib/conversation-types";

function messages(count: number, start = 1): StoredMessage[] {
  return Array.from({ length: count }, (_, index) => {
    const id = start + index;
    return {
      id,
      conversationId: "conversation",
      role: id % 2 === 0 ? "assistant" : "user",
      content: `message-${id}`,
      createdAt: "2026-09-14T00:00:00.000Z",
    };
  });
}

for (const count of [9, 10, 19]) {
  test(`preserves every pending message with ${count} messages before a full batch`, () => {
    const source = messages(count);
    const snapshot = structuredClone(source);
    const result = selectCompressionWindow(source);
    assert.deepEqual(result.batch, []);
    assert.deepEqual(result.rawTail, source);
    assert.deepEqual(source, snapshot);
  });
}

test("selects consecutive ten-message checkpoints before the raw tail", () => {
  const source = messages(30);
  const first = selectCompressionWindow(source);
  assert.deepEqual(first.batch.map(({ id }) => id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(first.rawTail.map(({ id }) => id), [21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);

  const second = selectCompressionWindow(source.filter(({ id }) => id > 10));
  assert.deepEqual(second.batch.map(({ id }) => id), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  assert.deepEqual(second.rawTail.map(({ id }) => id), [21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
});

test("serializes previous summary and exactly ten role-labelled messages", () => {
  const batch = messages(10);
  const request = buildSummaryRequest("старый summary", batch);
  assert.match(request, /"старый summary"/);
  assert.equal(request.split("\n").filter((line) => line.startsWith('{"role"')).length, 10);
  assert.match(request, /{"role":"user","content":"message-1"}/);
  assert.throws(() => buildSummaryRequest(null, batch.slice(1)), /10 сообщений/);
});

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { CHAT_SYSTEM_PROMPT, ChatAgent } from "../src/lib/chat-agent";
import { countChatPrompt } from "../src/lib/token-counter";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function agent(): ChatAgent {
  return ChatAgent.fromEnvironment({
    ...process.env,
    OPENAI_BASE_URL: "https://example.test/v1",
    OPENAI_API_KEY: "secret",
    OPENAI_MODEL: "deepseek-v4-flash",
  });
}

test("sends ordered system messages and a per-call output limit", async () => {
  let requestBody: unknown;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(
      'data: {"choices":[{"delta":{"content":"ok"}}],"usage":{"prompt_tokens":10,"completion_tokens":1,"total_tokens":11}}\n',
      { status: 200 },
    );
  };
  const response = await agent().respond(
    [{ role: "user", content: "question" }],
    AbortSignal.timeout(1_000),
    { systemMessages: ["base", "summary"], maxOutputTokens: 512 },
  );
  assert.equal(await new Response(response.stream).text(), "ok");
  const body = requestBody as { messages: unknown[]; max_tokens: number };
  assert.deepEqual(body.messages, [
    { role: "system", content: "base" },
    { role: "system", content: "summary" },
    { role: "user", content: "question" },
  ]);
  assert.equal(body.max_tokens, 512);
});

test("keeps Day 8 defaults and rejects invalid options before fetch", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n');
  };
  const response = await agent().respond(
    [{ role: "user", content: "question" }],
    AbortSignal.timeout(1_000),
  );
  await new Response(response.stream).text();
  assert.equal(calls, 1);
  await assert.rejects(
    agent().respond([], AbortSignal.timeout(1_000), { maxOutputTokens: 0 }),
    /Лимит ответа/,
  );
  assert.equal(calls, 1);

  const defaultCount = await countChatPrompt({ history: [], request: "question" });
  const explicitCount = await countChatPrompt({
    systemMessages: [CHAT_SYSTEM_PROMPT],
    history: [],
    request: "question",
  });
  assert.deepEqual(explicitCount, defaultCount);
});

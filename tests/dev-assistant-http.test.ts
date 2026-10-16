import assert from "node:assert/strict";
import { test } from "node:test";
import { DEV_ASSISTANT_LIMITS } from "../src/lib/dev-assistant-config";
import { handleHelpCommand, parseHelpCommand } from "../src/lib/dev-assistant-http";
import type { McpChatEvent } from "../src/lib/mcp-chat-types";

const url = "http://localhost:3000/api/dev-assistant/help";
function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: "POST", body, headers: { "Content-Type": "application/json", Host: "localhost:3000", ...headers } });
}

test("parses only the /help command", () => {
  assert.deepEqual(parseHelpCommand("/help"), { question: "" });
  assert.deepEqual(parseHelpCommand("  /help   Где лежат API?  "), { question: "Где лежат API?" });
  assert.deepEqual(parseHelpCommand("/help\nмногострочный\nвопрос"), { question: "многострочный\nвопрос" });
  for (const command of ["help", "/helpme", "/HELP вопрос", "вопрос без команды", "/status"]) {
    assert.ok("error" in parseHelpCommand(command), command);
  }
  assert.ok("error" in parseHelpCommand(`/help ${"я".repeat(DEV_ASSISTANT_LIMITS.maxQuestionCharacters + 1)}`));
  assert.ok("error" in parseHelpCommand(42));
});

test("rejects foreign origins, extra fields, unknown commands and oversized bodies", async () => {
  assert.equal((await handleHelpCommand(post('{"command":"/help"}', { Origin: "https://evil.example" }))).status, 403);
  assert.equal((await handleHelpCommand(post('{"command":"/help"}', { "Content-Type": "text/plain" }))).status, 400);
  assert.equal((await handleHelpCommand(post('{"command":"/help","history":[]}'))).status, 400);
  const unknown = await handleHelpCommand(post('{"command":"Как устроен проект?"}'));
  assert.equal(unknown.status, 400);
  assert.match((await unknown.json()).error, /\/help/);
  assert.equal((await handleHelpCommand(post(JSON.stringify({ command: `/help ${"x".repeat(DEV_ASSISTANT_LIMITS.maxRequestBytes)}` })))).status, 413);
});

test("bare /help answers with the current branch from MCP without calling the LLM", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("LLM must not be called"); };
  try {
    const response = await handleHelpCommand(post('{"command":"/help"}'));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/x-ndjson/);
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as McpChatEvent);
    assert.deepEqual(events.map(({ type }) => type), ["tool-start", "tool-result", "text", "done"]);
    const result = events[1].type === "tool-result" ? events[1].result : null;
    assert.equal(result?.isError, false);
    const branch = (result?.structuredContent as { branch: string | null }).branch;
    const text = events[2].type === "text" ? events[2].delta : "";
    assert.match(text, /Flash Dev/);
    // Справка не содержит ссылок [S…]: без search_docs их нечем подтвердить.
    assert.doesNotMatch(text, /\[S\d+\]/);
    assert.ok(branch === null ? text.includes("detached HEAD") : text.includes(`\`${branch}\``));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

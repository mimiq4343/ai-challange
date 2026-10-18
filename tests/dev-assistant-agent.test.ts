import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, test } from "node:test";
import { DEV_ASSISTANT_LIMITS } from "../src/lib/dev-assistant-config";
import type { McpToolEvent } from "../src/lib/mcp-chat-types";
import { McpToolChatAgent } from "../src/lib/mcp-tool-chat-agent";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

let root: string;
before(() => {
  root = mkdtempSync(join(tmpdir(), "dev-assistant-agent-"));
  execFileSync("git", ["-C", root, "init", "-q", "-b", "day-31"]);
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "docs/api.md"), "# API\n");
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-q", "-m", "init"]);
});
after(() => rmSync(root, { recursive: true, force: true }));

const usage = { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 };
type ProviderRequest = { messages: { role: string; content?: string; tool_call_id?: string }[]; tools?: { function: { name: string } }[]; tool_choice?: string };

function sse(events: unknown[]): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n");
}
function calls(...selected: [string, string, string][]): Response {
  return sse([
    { choices: [{ index: 0, delta: { tool_calls: selected.map(([id, name, args], index) => ({ index, id, type: "function", function: { name, arguments: args } })) }, finish_reason: "tool_calls" }] },
    { choices: [], usage },
  ]);
}
function answer(text: string): Response {
  return sse([{ choices: [{ index: 0, delta: { content: text }, finish_reason: "stop" }] }, { choices: [], usage }]);
}
function provider(reply: (request: ProviderRequest, round: number) => Response) {
  const requests: ProviderRequest[] = [];
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /^https:\/\/provider\.example\//);
    const body = JSON.parse(String(init?.body)) as ProviderRequest;
    requests.push(body);
    return reply(body, requests.length);
  };
  return requests;
}
const env = { NODE_ENV: "test", OPENAI_BASE_URL: "https://provider.example/v1", OPENAI_API_KEY: "test-key", OPENAI_MODEL: "deepseek-flash" } as NodeJS.ProcessEnv;
const agent = (events: McpToolEvent[]) => McpToolChatAgent.fromEnvironment({ onToolEvent: (event) => events.push(event), access: { kind: "project" }, projectRoot: root }, env);
const question = [{ role: "user" as const, content: "Какая сейчас ветка и что лежит в docs?" }];

test("the model selects project tools over stdio and recovers from rejected arguments", async () => {
  const events: McpToolEvent[] = [];
  const requests = provider((_request, round) => round === 1
    ? calls(["c1", "git_branch", "{}"], ["c2", "list_files", '{"path":"docs"}'])
    : round === 2 ? calls(["c3", "git_diff", '{"path":"../outside"}'])
      : answer("Ветка `day-31`, в docs лежит api.md."));
  const response = await agent(events).respond(question, AbortSignal.timeout(60_000), { systemMessages: ["Тест"] });
  assert.equal(await new Response(response.stream).text(), "Ветка `day-31`, в docs лежит api.md.");
  assert.equal(await response.finishReason, "stop");
  assert.deepEqual(await response.usage, { promptTokens: 30, completionTokens: 9, totalTokens: 39, cacheHitTokens: null, cacheMissTokens: null });

  assert.deepEqual(requests[0].tools?.map(({ function: tool }) => tool.name), ["search_docs", "git_branch", "git_status", "list_files", "git_diff"]);
  assert.match(requests[0].messages.map(({ content }) => content).join("\n"), /search_docs\(query, limit\)/);
  const results = events.filter((event) => event.type === "tool-result");
  assert.deepEqual(events.filter((event) => event.type === "tool-start").map((event) => event.name), ["git_branch", "list_files", "git_diff"]);
  assert.equal((results[0].result.structuredContent as { branch: string }).branch, "day-31");
  assert.deepEqual((results[1].result.structuredContent as { entries: unknown }).entries, [{ name: "api.md", type: "file", files: 1 }]);
  assert.equal(results[2].result.isError, true);
  assert.match(results[2].result.content[0].text, /не прошли проверку и не отправлены на сервер/);
  assert.ok(requests[2].messages.some((message) => message.role === "tool" && message.tool_call_id === "c3"));
});

test("after the tool budget the model explicitly disables calls and retains the tool catalog", async () => {
  const events: McpToolEvent[] = [];
  const requests = provider((request, round) => request.tool_choice === "none" ? answer("Итог по git_status.") : calls([`c${round}`, "git_status", "{}"]));
  const response = await agent(events).respond(question, AbortSignal.timeout(60_000), { systemMessages: ["Тест"] });
  assert.equal(await new Response(response.stream).text(), "Итог по git_status.");
  assert.equal(requests.length, DEV_ASSISTANT_LIMITS.maxRounds);
  assert.equal(requests.at(-1)!.tool_choice, "none");
  assert.deepEqual(requests.at(-1)!.tools, requests[0].tools);
  assert.match(requests.at(-1)!.messages.at(-1)!.content!, /бюджет.*исчерпан/i);
  assert.equal(events.filter((event) => event.type === "tool-result").length, DEV_ASSISTANT_LIMITS.maxRounds - 1);
});

test("project mode refuses an HTTP endpoint", () => {
  assert.throws(() => McpToolChatAgent.fromEnvironment({ endpoint: "https://mcp.yees.ai/mcp", onToolEvent: () => undefined, access: { kind: "project" } }, env),
    /Для MCP-чата нужны/);
});

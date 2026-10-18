import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { handleReviewAgent } from "../src/lib/code-review-agent-http";
import { consumeMcpChatStream } from "../src/lib/mcp-chat-stream";
import type { McpChatEvent } from "../src/lib/mcp-chat-types";

const originalFetch = globalThis.fetch;
const previous = { ...process.env };
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...previous }; });

async function repository(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "flash-review-agent-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  git("init", "-qb", "main"); git("config", "user.email", "test@example.com"); git("config", "user.name", "Test");
  git("remote", "add", "origin", "https://github.com/owner/repo.git");
  await writeFile(join(root, "README.md"), "# Base\n"); git("add", "."); git("commit", "-qm", "base"); git("branch", "day-32");
  return { root, git };
}
function request(body: unknown, origin = "http://localhost") {
  return new Request("http://localhost/api/code-review/agent", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
}
const input = { message: "Проверь выбранные ветки", baseRef: "refs/heads/main", headRef: "refs/heads/day-32" };
function sse(delta: unknown, finish: string) {
  return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`);
}
function configure() {
  process.env.OPENAI_BASE_URL = "https://provider.example/v1";
  process.env.OPENAI_API_KEY = "test-key";
}

test("web agent chooses the real review tool and streams its immutable diff and report", async (t) => {
  const { root, git } = await repository(t);
  await writeFile(join(root, "README.md"), "dirty working tree\n");
  configure();
  const requests: { tools?: { function: { name: string } }[]; messages: { role: string; content: string }[] }[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://provider.example/v1/chat/completions");
    const body = JSON.parse(String(init?.body)); requests.push(body);
    return requests.length === 1
      ? sse({ tool_calls: [{ index: 0, id: "review-1", type: "function", function: { name: "review_changes", arguments: JSON.stringify({ baseRef: input.baseRef, headRef: input.headRef }) } }] }, "tool_calls")
      : sse({ content: "Закоммиченных изменений нет; сравнение завершено." }, "stop");
  };
  const response = await handleReviewAgent(request(input), root);
  assert.equal(response.status, 200);
  const events: McpChatEvent[] = [];
  await consumeMcpChatStream(response.body!, event => events.push(event));
  assert.deepEqual(requests[0].tools?.map(tool => tool.function.name), ["review_changes", "review_pr"]);
  assert.ok(events.some(event => event.type === "tool-start" && event.name === "review_changes"));
  const result = events.find(event => event.type === "review" && event.event.type === "result");
  assert.ok(result?.type === "review" && result.event.type === "result");
  assert.equal(result.repository, "owner/repo");
  assert.equal(result.event.report.snapshot.totalFiles, 0);
  assert.equal(result.event.report.snapshot.headSha, git("rev-parse", "HEAD"));
  assert.equal(events.at(-1)?.type, "done");
  assert.equal(git("status", "--porcelain"), "M README.md");
  assert.equal(git("branch", "--show-current"), "main");
});

test("agent HTTP boundary rejects foreign origins, extra fields, unknown refs and excessive input", async (t) => {
  const { root } = await repository(t);
  assert.equal((await handleReviewAgent(request(input, "https://evil.example"), root)).status, 403);
  for (const body of [{ ...input, message: "" }, { ...input, root: "/etc" }, { ...input, headRef: "--exec=bad" }]) {
    assert.equal((await handleReviewAgent(request(body), root)).status, 400);
  }
  assert.equal((await handleReviewAgent(request({ ...input, message: "x".repeat(30_000) }), root)).status, 413);
});

test("a missing PR is a tool error with no fabricated review and no GitHub writes", async (t) => {
  const { root } = await repository(t);
  configure();
  let rounds = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url) === "https://api.github.com/repos/owner/repo/pulls/42") {
      assert.equal(init?.method ?? "GET", "GET");
      return new Response("private response", { status: 404 });
    }
    assert.equal(String(url), "https://provider.example/v1/chat/completions");
    return ++rounds === 1
      ? sse({ tool_calls: [{ index: 0, id: "pr-1", type: "function", function: { name: "review_pr", arguments: '{"repository":"owner/repo","number":42}' } }] }, "tool_calls")
      : sse({ content: "PR не найден или недоступен." }, "stop");
  };
  const response = await handleReviewAgent(request({ ...input, message: "Проверь PR #42" }), root);
  const events: McpChatEvent[] = [];
  await consumeMcpChatStream(response.body!, event => events.push(event));
  assert.ok(events.some(event => event.type === "tool-result" && event.result.isError));
  assert.equal(events.some(event => event.type === "review" && event.event.type === "result"), false);
  assert.equal(JSON.stringify(events).includes("private response"), false);
});

test("a final agent failure retains the completed review event and never emits done", async (t) => {
  const { root } = await repository(t); configure();
  let rounds = 0;
  globalThis.fetch = async () => ++rounds === 1
    ? sse({ tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "review_changes", arguments: JSON.stringify({ baseRef: input.baseRef, headRef: input.headRef }) } }] }, "tool_calls")
    : sse({ content: "incomplete" }, "length");
  const response = await handleReviewAgent(request(input), root);
  const events: McpChatEvent[] = [];
  await assert.rejects(consumeMcpChatStream(response.body!, event => events.push(event)));
  assert.ok(events.some(event => event.type === "review" && event.event.type === "result"));
  assert.equal(events.some(event => event.type === "done"), false);
});

test("canceling the web request interrupts the provider and produces no report or done", async (t) => {
  const { root } = await repository(t); configure();
  const started = Promise.withResolvers<void>();
  let canceled = false;
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
    const abort = () => { canceled = true; reject(init?.signal?.reason); };
    if (init?.signal?.aborted) abort(); else init?.signal?.addEventListener("abort", abort, { once: true });
    started.resolve();
  });
  const controller = new AbortController();
  const response = await handleReviewAgent(new Request(request(input), { signal: controller.signal }), root);
  await started.promise;
  controller.abort(new Error("cancelled"));
  const events: McpChatEvent[] = [];
  await assert.rejects(consumeMcpChatStream(response.body!, event => events.push(event)), /оборвал/);
  assert.equal(canceled, true);
  assert.equal(events.some(event => event.type === "done" || event.type === "review"), false);
});

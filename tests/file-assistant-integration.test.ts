import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { ProjectFiles } from "../src/lib/file-assistant-files";
import { handleFileAssistant, handleApplyFileProposal } from "../src/lib/file-assistant-http";
import { fileProposalSchema } from "../src/lib/file-assistant-types";
import { McpToolChatAgent } from "../src/lib/mcp-tool-chat-agent";
import type { McpToolEvent } from "../src/lib/mcp-chat-types";
import { withProjectMcpTools } from "../src/lib/project-mcp-client";
import { FILE_ASSISTANT_CONFIG } from "../src/lib/file-assistant-config";

let root: string;
const originalFetch = globalThis.fetch;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "file-assistant-integration-"));
  execFileSync("git", ["-C", root, "init", "-q", "-b", "day-34"]);
  mkdirSync(join(root, "src")); mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "src/button.tsx"), "export function Button() {}\n");
  writeFileSync(join(root, "docs/api.md"), "# API\n");
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-qm", "initial"]);
});
afterEach(() => { globalThis.fetch = originalFetch; rmSync(root, { recursive: true, force: true }); });

const request = (payload: unknown, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/file-assistant", {
  method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(payload),
});

test("files mode exposes real stdio tools, validates arguments and only prepares writes", async () => {
  await withProjectMcpTools(AbortSignal.timeout(60_000), async session => {
    assert.ok(session.tools.some(tool => tool.name === "read_file"));
    assert.ok(session.tools.some(tool => tool.name === "propose_file"));
    assert.ok(!session.tools.some(tool => /apply|shell|exec/.test(tool.name)));
    assert.ok(!session.tools.some(tool => tool.name === "git_diff" || tool.name === "search_docs"), "raw git diffs and an old RAG snapshot cannot bypass file access rules");
    const search = await session.callTool("search_files", { query: "Button", path: "src" });
    assert.equal(search.isError, undefined);
    assert.match(JSON.stringify(search.structuredContent), /src\/button.tsx/);
    const read = await session.callTool("read_file", { path: "docs/api.md" });
    const proposed = await session.callTool("propose_file", { path: "docs/api.md", baseHash: read.structuredContent!.hash, edits: [{ oldText: "# API", newText: "# Button API" }] });
    assert.equal(proposed.isError, undefined);
    assert.equal(fileProposalSchema.parse(proposed.structuredContent).status, "pending");
    assert.equal(readFileSync(join(root, "docs/api.md"), "utf8"), "# API\n");
    const rejected = await session.callTool("read_file", { path: "../outside" });
    assert.equal(rejected.isError, true);
  }, root, true);
});

test("the model chooses search, reading and a proposal; the tool catalog has no write bypass", async () => {
  const events: McpToolEvent[] = [];
  let round = 0;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    const names = body.tools.map((tool: { function: { name: string } }) => tool.function.name);
    assert.ok(names.includes("propose_file"));
    const tool = (name: string, args: object) => ({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `call-${round}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: "tool_calls" }] });
    round++;
    const event = round === 1 ? tool("search_files", { query: "Button", path: "src" })
      : round === 2 ? tool("read_file", { path: "src/button.tsx" })
        : round === 3 ? tool("propose_file", { path: "docs/generated.md", baseHash: null, content: "# Button\n\nКомпонент в src/button.tsx.\n" + "Описание компонента.\n".repeat(150) })
          : { choices: [{ index: 0, delta: { content: "Подготовлен docs/generated.md; примените diff." }, finish_reason: "stop" }] };
    return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`);
  };
  const env = { NODE_ENV: "test", OPENAI_BASE_URL: "https://provider.example/v1", OPENAI_API_KEY: "test-key", OPENAI_MODEL: "deepseek-flash" } as NodeJS.ProcessEnv;
  const agent = McpToolChatAgent.fromEnvironment({ access: { kind: "files" }, projectRoot: root, onToolEvent: event => events.push(event) }, env);
  const response = await agent.respond([{ role: "user", content: "Документируй Button" }], AbortSignal.timeout(60_000));
  assert.match(await new Response(response.stream).text(), /Подготовлен/);
  assert.deepEqual(events.filter(event => event.type === "tool-start").map(event => event.name), ["search_files", "read_file", "propose_file"]);
  const result = events.filter(event => event.type === "tool-result").at(-1)!;
  assert.equal(result.result.isError, false);
});

test("HTTP rejects cross-origin, extra fields and oversized input before inference", async () => {
  assert.equal((await handleFileAssistant(request({ message: "test" }, "https://foreign.example"), root)).status, 403);
  assert.equal((await handleFileAssistant(request({ message: "test", root: "/etc" }), root)).status, 400);
  assert.equal((await handleFileAssistant(request({ message: "x".repeat(30_000) }), root)).status, 413);
  assert.equal((await handleApplyFileProposal(request({ id: "invalid" }), root)).status, 400);
});

test("apply API accepts only a server proposal ID and reports a target conflict", async () => {
  const files = new ProjectFiles(root);
  const proposal = files.propose("docs/new.md", null, "# New\n");
  assert.equal((await handleApplyFileProposal(request({ id: proposal.id, content: "injected" }), root)).status, 400);
  const applied = await handleApplyFileProposal(request({ id: proposal.id }), root);
  assert.equal(applied.status, 200);
  assert.equal((await applied.json()).status, "applied");
  assert.equal(readFileSync(join(root, "docs/new.md"), "utf8"), "# New\n");
  const read = files.read("docs/api.md");
  const conflicting = files.propose("docs/api.md", read.hash, "# Changed\n");
  writeFileSync(join(root, "docs/api.md"), "Human edit\n");
  assert.equal((await handleApplyFileProposal(request({ id: conflicting.id }), root)).status, 409);
});

for (const callsPerRound of [1, 4]) {
  test(`reserves target reading and a document proposal before exhausting ${callsPerRound} calls per round`, async () => {
    const events: McpToolEvent[] = [];
    let requests = 0;
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      requests++;
      const names: string[] = (body.tools ?? []).map((tool: { function: { name: string } }) => tool.function.name);
      const results = body.messages.filter((message: { role: string }) => message.role === "tool")
        .map((message: { content: string }) => JSON.parse(message.content).structuredContent);
      let selected: { name: string; args: object }[] = [];
      if (body.tool_choice === "none" || results.some((result: unknown) => fileProposalSchema.safeParse(result).success)) selected = [];
      else if (names.includes("search_files")) selected = Array.from({ length: callsPerRound }, () => ({ name: "read_file", args: { path: "src/button.tsx" } }));
      else if (names.includes("read_file")) selected = [{ name: "read_file", args: { path: "docs/api.md" } }];
      else if (names.includes("propose_file") && body.tool_choice !== "none") {
        const target = results.findLast((read: { path?: string; hash?: string }) => read?.path === "docs/api.md" && typeof read.hash === "string");
        assert.ok(target?.hash, "the completion budget must allow reading an existing target first");
        selected = [{ name: "propose_file", args: { path: "docs/api.md", baseHash: target.hash, edits: [{ oldText: "# API", newText: "# ADR\n\n## Контекст\nButton\n\n## Решение\nСохранить компонент.\n\n## Последствия\nСуществующий API сохраняется." }] } }];
      }
      const event = selected.length ? { choices: [{ index: 0, delta: { tool_calls: selected.map((call, index) => ({ index, id: `${requests}-${index}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } })) }, finish_reason: "tool_calls" }] }
        : { choices: [{ index: 0, delta: { content: "Итог по подтверждённым результатам." }, finish_reason: "stop" }] };
      return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`);
    };
    const env = { NODE_ENV: "test", OPENAI_BASE_URL: "https://provider.example/v1", OPENAI_API_KEY: "test-key", OPENAI_MODEL: "deepseek-flash" } as NodeJS.ProcessEnv;
    const agent = McpToolChatAgent.fromEnvironment({ access: { kind: "files" }, projectRoot: root, onToolEvent: event => events.push(event) }, env);
    const response = await agent.respond([{ role: "user", content: "Подготовь ADR в docs/api.md по Button" }], AbortSignal.timeout(60_000));
    await new Response(response.stream).text();
    const calls = events.filter(event => event.type === "tool-start");
    assert.ok(calls.some(call => call.name === "propose_file"), "the agent exhausted exploration without preparing the requested file");
    assert.ok(calls.length <= FILE_ASSISTANT_CONFIG.maxToolCalls);
    assert.ok(requests <= FILE_ASSISTANT_CONFIG.maxRounds);
    const result = events.filter(event => event.type === "tool-result").at(-1)!;
    assert.equal(result.result.isError, false);
    assert.equal(fileProposalSchema.parse(result.result.structuredContent).path, "docs/api.md");
    assert.equal(readFileSync(join(root, "docs/api.md"), "utf8"), "# API\n");
  });
}

test("a read-only request can finish without a proposal and cannot execute search outside the remaining catalog", async () => {
  const events: McpToolEvent[] = [];
  let round = 0;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    round++;
    assert.equal(body.tool_choice, "auto");
    const previous = body.messages.filter((message: { role: string }) => message.role === "tool").at(-1);
    const rejected = previous && JSON.parse(previous.content).isError;
    const names = body.tools.map((tool: { function: { name: string } }) => tool.function.name);
    const name = names.includes("search_files") ? "read_file" : "search_files";
    const args = name === "read_file" ? { path: "src/button.tsx" } : { query: "Button" };
    const delta = rejected ? { content: "Button объявлен в src/button.tsx:1. Поиск завершён без создания файлов." }
      : { tool_calls: [{ index: 0, id: `read-${round}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] };
    return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: rejected ? "stop" : "tool_calls" }] })}\n\ndata: [DONE]\n\n`);
  };
  const env = { NODE_ENV: "test", OPENAI_BASE_URL: "https://provider.example/v1", OPENAI_API_KEY: "test-key", OPENAI_MODEL: "deepseek-flash" } as NodeJS.ProcessEnv;
  const agent = McpToolChatAgent.fromEnvironment({ access: { kind: "files" }, projectRoot: root, onToolEvent: event => events.push(event) }, env);
  const response = await agent.respond([{ role: "user", content: "Где объявлен Button?" }], AbortSignal.timeout(60_000));
  assert.match(await new Response(response.stream).text(), /без создания файлов/);
  assert.ok(!events.some(event => event.type === "tool-start" && event.name === "propose_file"));
  const last = events.filter(event => event.type === "tool-result").at(-1)!;
  assert.equal(last.result.isError, true);
  assert.match(last.result.content[0].text, /недоступен в этом раунде/);
  assert.equal(last.result.structuredContent, undefined, "the late search must not execute on the MCP server");
});

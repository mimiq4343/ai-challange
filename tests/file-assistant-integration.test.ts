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

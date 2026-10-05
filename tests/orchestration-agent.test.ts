import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { McpToolEvent } from "../src/lib/mcp-chat-types";
import { MCP_PUBLIC_URL } from "../src/lib/mcp-config";
import { McpToolChatAgent } from "../src/lib/mcp-tool-chat-agent";
import { DEEPWIKI_MCP_URL, ORCHESTRATION_LIMITS } from "../src/lib/orchestration-config";
import type { McpServerStatus } from "../src/lib/orchestration-types";
import { PIPELINE_MCP_URL } from "../src/lib/pipeline-config";
import { SCHEDULER_MCP_URL } from "../src/lib/scheduler-config";

const pipelineToken = "pipeline-credential-for-orchestration-tests";
const schedulerToken = "scheduler-credential-for-orchestration-tests";
const searchId = "85daa3b0-8848-4cb0-8edc-5cc008d8910a";
const summaryId = "5948e138-c0ed-4fe8-ade0-0d4a0bfb3ef7";
const reportId = "772050e4-21ee-46db-81ef-7be986492e14";
const jobId = "0b8f5c1e-5f55-4c2b-9d1e-3f6f5b0a1c2d";
const foreignId = "23ce33a1-f6ea-443c-8f9b-09f75a230679";
const createdAt = "2026-09-28T00:00:00.000Z";
const env = {
  NODE_ENV: "test" as const, OPENAI_BASE_URL: "https://provider.example/v1", OPENAI_API_KEY: "provider-key",
  OPENAI_MODEL: "deepseek-flash", MCP_PIPELINE_TOKEN: pipelineToken, MCP_SCHEDULER_TOKEN: schedulerToken,
};

type ServerId = "pipeline" | "flash" | "deepwiki" | "scheduler";
const FAKE_SERVERS: Record<string, { id: ServerId; tools: string[]; token?: string }> = {
  [PIPELINE_MCP_URL]: { id: "pipeline", tools: ["search_repositories", "summarize_repositories", "save_to_file"], token: pipelineToken },
  [MCP_PUBLIC_URL]: { id: "flash", tools: ["get_repository_info", "add", "get_current_time"] },
  [DEEPWIKI_MCP_URL]: { id: "deepwiki", tools: ["ask_wiki_question", "read_wiki_structure", "read_wiki_contents"] },
  [SCHEDULER_MCP_URL]: { id: "scheduler", tools: ["create_repository_schedule", "list_repository_schedules", "stop_repository_schedule", "get_repository_summary"], token: schedulerToken },
};

type Call = { name: string; arguments: Record<string, unknown> };
type Execution = { server: ServerId; tool: string; arguments: Record<string, unknown> };
type ProviderRequest = { messages: Record<string, unknown>[]; tools?: { function: { name: string } }[] };

const scenario: Call[] = [
  { name: "pipeline__search_repositories", arguments: { query: "sqlite language:TypeScript" } },
  { name: "flash__get_repository_info", arguments: { owner: "kysely-org", repo: "kysely" } },
  { name: "deepwiki__ask_wiki_question", arguments: { repoName: "kysely-org/kysely", question: "Как устроены миграции?" } },
  { name: "pipeline__summarize_repositories", arguments: { searchResultId: searchId } },
  { name: "pipeline__save_to_file", arguments: { summaryId } },
  { name: "scheduler__create_repository_schedule", arguments: { owner: "kysely-org", repo: "kysely", intervalMinutes: 60 } },
];

function structured(data: Record<string, unknown>) {
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
}

function defaultResult(server: ServerId, tool: string): Record<string, unknown> {
  if (server === "deepwiki") return { content: [{ type: "text", text: "Миграции выполняет класс Migrator." }] };
  if (server === "flash") return structured({ fullName: "kysely-org/kysely", stars: 12_000 });
  if (server === "scheduler") return structured({ jobId, status: "active" });
  if (tool === "search_repositories") return structured({ searchResultId: searchId, query: "sqlite", repositories: [], createdAt });
  if (tool === "summarize_repositories") return structured({ summaryId, searchResultId: searchId, markdown: "# Обзор\n", createdAt });
  return structured({ reportId, summaryId, searchResultId: searchId, query: "sqlite", fileName: `${reportId}.md`, downloadUrl: `/api/pipeline/reports/${reportId}`, createdAt });
}

function selection(call: Call, round: number): Response {
  return stream({ reasoning_content: "private reasoning", tool_calls: [{
    index: 0, id: `step-${round}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) },
  }] }, "tool_calls");
}
function stream(delta: unknown, finish: string): Response {
  return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\ndata: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } })}\n\ndata: [DONE]\n\n`);
}
function final(): Response { return stream({ content: "Готово: шаги выполнены." }, "stop"); }

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function boundary(options: {
  provider: (request: ProviderRequest, round: number) => Response;
  down?: ServerId[];
  failingCalls?: ServerId[];
}) {
  const executions: Execution[] = [];
  const requests: ProviderRequest[] = [];
  const contacted = new Set<ServerId>();
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    if (url.startsWith("https://provider.example/")) {
      assert.equal(String(init?.body).includes(pipelineToken) || String(init?.body).includes(schedulerToken), false);
      const request = JSON.parse(String(init?.body));
      requests.push(request);
      return options.provider(request, requests.length);
    }
    const server = FAKE_SERVERS[url];
    assert.ok(server, `Неожиданный адрес ${url}`);
    contacted.add(server.id);
    // Каждый сервер получает только собственные учётные данные; внешний и публичный — никаких.
    assert.equal(headers.get("Authorization"), server.token ? `Bearer ${server.token}` : null);
    assert.equal(headers.get("X-Flash-Profile-Id"), server.token ? "7" : null);
    if (init?.method === "GET") return new Response(null, { status: 405 });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    const body = JSON.parse(String(init?.body));
    if (body.method.startsWith("notifications/")) return new Response(null, { status: 202 });
    let payload;
    if (body.method === "initialize") {
      if (options.down?.includes(server.id)) return new Response("unavailable", { status: 503 });
      payload = { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: server.id, version: "1" } };
    } else if (body.method === "tools/list") {
      payload = { tools: server.tools.map((name) => ({ name, description: `${server.id} ${name}`, inputSchema: { type: "object" } })) };
    } else if (body.method === "tools/call") {
      if (options.failingCalls?.includes(server.id)) return new Response("boom", { status: 500 });
      executions.push({ server: server.id, tool: body.params.name, arguments: body.params.arguments });
      payload = defaultResult(server.id, body.params.name);
    } else throw new Error(`Unexpected MCP method ${body.method}`);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: payload }), {
      headers: { "Content-Type": "application/json", "Mcp-Session-Id": `${server.id}-session` },
    });
  };
  return { executions, requests, contacted };
}

function agent(events: McpToolEvent[] = [], statuses: McpServerStatus[][] = []) {
  return McpToolChatAgent.fromEnvironment({
    access: { kind: "orchestration", profileId: 7 },
    onToolEvent: (event) => events.push(event),
    onServers: (value) => statuses.push(value),
  }, env);
}
const messages = [{ role: "user" as const, content: "Подбери библиотеку, проверь лидера, спроси DeepWiki, сохрани отчёт и поставь мониторинг." }];

test("a six-step flow is routed across four servers in the model-chosen order", async () => {
  const events: McpToolEvent[] = [];
  const statuses: McpServerStatus[][] = [];
  const { executions, requests } = boundary({ provider: (_request, round) => round <= scenario.length ? selection(scenario[round - 1], round) : final() });
  const response = await agent(events, statuses).respond(messages, AbortSignal.timeout(5_000));
  const text = await new Response(response.stream).text();

  assert.deepEqual(executions, [
    { server: "pipeline", tool: "search_repositories", arguments: { query: "sqlite language:TypeScript" } },
    { server: "flash", tool: "get_repository_info", arguments: { owner: "kysely-org", repo: "kysely" } },
    { server: "deepwiki", tool: "ask_wiki_question", arguments: { repoName: "kysely-org/kysely", question: "Как устроены миграции?" } },
    { server: "pipeline", tool: "summarize_repositories", arguments: { searchResultId: searchId } },
    { server: "pipeline", tool: "save_to_file", arguments: { summaryId } },
    { server: "scheduler", tool: "create_repository_schedule", arguments: { owner: "kysely-org", repo: "kysely", intervalMinutes: 60 } },
  ]);
  // Каждый следующий раунд модели видит результат предыдущего шага.
  for (let round = 2; round <= scenario.length + 1; round += 1) {
    assert.deepEqual({ role: requests[round - 1].messages.at(-1)?.role, id: requests[round - 1].messages.at(-1)?.tool_call_id }, { role: "tool", id: `step-${round - 1}` });
  }
  assert.deepEqual(
    events.filter((event) => event.type === "tool-start").map((event) => `${event.server?.name}:${event.name}`),
    ["Flash Pipeline:search_repositories", "Flash GitHub:get_repository_info", "DeepWiki:ask_wiki_question",
      "Flash Pipeline:summarize_repositories", "Flash Pipeline:save_to_file", "Flash Scheduler:create_repository_schedule"],
  );
  assert.match(text, new RegExp(`\\(/api/pipeline/reports/${reportId}\\)`));
  assert.deepEqual(statuses[0].map(({ id, status }) => `${id}:${status}`), ["pipeline:available", "flash:available", "deepwiki:available", "scheduler:available"]);
});

test("the model sees one namespaced catalog without tools outside the allowlist", async () => {
  const { requests } = boundary({ provider: () => final() });
  await new Response((await agent().respond(messages, AbortSignal.timeout(5_000))).stream).text();
  assert.deepEqual(requests[0].tools?.map((tool) => tool.function.name).sort(), [
    "deepwiki__ask_wiki_question", "deepwiki__read_wiki_structure", "flash__get_repository_info",
    "pipeline__save_to_file", "pipeline__search_repositories", "pipeline__summarize_repositories",
    "scheduler__create_repository_schedule", "scheduler__get_repository_summary",
    "scheduler__list_repository_schedules", "scheduler__stop_repository_schedule",
  ]);
});

test("an unavailable server is dropped from the catalog and reported while the others keep working", async () => {
  const statuses: McpServerStatus[][] = [];
  const { executions, requests } = boundary({
    down: ["deepwiki"],
    provider: (_request, round) => round === 1 ? selection(scenario[1], round) : final(),
  });
  await new Response((await agent([], statuses).respond(messages, AbortSignal.timeout(5_000))).stream).text();
  assert.equal(statuses[0].find(({ id }) => id === "deepwiki")?.status, "unavailable");
  assert.equal(requests[0].tools?.some((tool) => tool.function.name.startsWith("deepwiki__")), false);
  assert.ok(requests[0].messages.some((message) => message.role === "system" && String(message.content).includes("недоступны MCP-серверы: deepwiki")));
  assert.deepEqual(executions.map(({ server }) => server), ["flash"]);
});

test("a dependent step with an identifier from outside this run is refused before reaching the server", async () => {
  const events: McpToolEvent[] = [];
  const calls = [
    { name: "pipeline__summarize_repositories", arguments: { searchResultId: foreignId } },
    scenario[0],
    scenario[3],
  ];
  const { executions, requests } = boundary({ provider: (_request, round) => round <= calls.length ? selection(calls[round - 1], round) : final() });
  await new Response((await agent(events).respond(messages, AbortSignal.timeout(5_000))).stream).text();
  assert.deepEqual(executions.map(({ tool }) => tool), ["search_repositories", "summarize_repositories"]);
  const refusal = events.find((event) => event.type === "tool-result" && event.callId === "step-1");
  assert.equal(refusal?.type === "tool-result" && refusal.result.isError, true);
  assert.match(String(requests[1].messages.at(-1)?.content), /searchResultId не получен/);
});

test("arguments rejected by the local schema are returned to the model and never sent to DeepWiki", async () => {
  const invalid = { name: "deepwiki__ask_wiki_question", arguments: { repoName: "https://github.com/kysely-org/kysely", question: "Как?" } };
  const { executions, requests, contacted } = boundary({ provider: (_request, round) => round === 1 ? selection(invalid, round) : final() });
  await new Response((await agent().respond(messages, AbortSignal.timeout(5_000))).stream).text();
  assert.deepEqual(executions, []);
  assert.ok(contacted.has("deepwiki"));
  assert.match(String(requests[1].messages.at(-1)?.content), /не отправлены на сервер/);
});

test("a transport failure on one server becomes a failed step and the flow continues", async () => {
  const events: McpToolEvent[] = [];
  const { executions } = boundary({
    failingCalls: ["deepwiki"],
    provider: (_request, round) => round === 1 ? selection(scenario[2], round) : round === 2 ? selection(scenario[1], round) : final(),
  });
  const response = await agent(events).respond(messages, AbortSignal.timeout(5_000));
  assert.equal(await new Response(response.stream).text(), "Готово: шаги выполнены.");
  const failure = events.find((event) => event.type === "tool-result" && event.callId === "step-1");
  assert.equal(failure?.type === "tool-result" && failure.result.isError && failure.result.content[0].text.startsWith("DeepWiki:"), true);
  assert.deepEqual(executions.map(({ server }) => server), ["flash"]);
});

test("after the call budget the model must summarise without tools instead of failing the flow", async () => {
  const { executions, requests } = boundary({
    provider: (request, round) => request.tools ? selection({ name: "flash__get_repository_info", arguments: { owner: "owner", repo: `repo-${round}` } }, round) : final(),
  });
  const response = await agent().respond(messages, AbortSignal.timeout(5_000));
  assert.equal(await new Response(response.stream).text(), "Готово: шаги выполнены.");
  assert.equal(executions.length, ORCHESTRATION_LIMITS.maxToolCalls);
  assert.equal(requests.at(-1)?.tools, undefined);
});

test("orchestration refuses a single endpoint override or missing credentials before network access", () => {
  const { requests, contacted } = boundary({ provider: () => final() });
  assert.throws(() => McpToolChatAgent.fromEnvironment({ endpoint: DEEPWIKI_MCP_URL, access: { kind: "orchestration", profileId: 7 }, onToolEvent() {} }, env));
  assert.throws(() => McpToolChatAgent.fromEnvironment({ access: { kind: "orchestration", profileId: 7 }, onToolEvent() {} }, { ...env, MCP_SCHEDULER_TOKEN: undefined }));
  assert.deepEqual(requests, []);
  assert.equal(contacted.size, 0);
});

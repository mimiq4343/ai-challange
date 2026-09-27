import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { fetchGitHubRepository, GitHubRepositoryError } from "../src/lib/github-repository-tool";
import { createDemoMcpServer } from "../src/lib/mcp-demo-server";

const githubPayload = {
  full_name: "octocat/Hello-World",
  description: "My first repository on GitHub!",
  language: "JavaScript",
  stargazers_count: 42,
  forks_count: 7,
  html_url: "https://github.com/octocat/Hello-World",
  private: false,
};

async function connectClient(t: TestContext): Promise<Client> {
  const server = createDemoMcpServer();
  const client = new Client({ name: "github-tool-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

function rejectsWithCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof GitHubRepositoryError && error.code === code;
}

test("SDK discovery and calls expose validated public GitHub metadata without credentials", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), "https://api.github.com/repos/octocat/Hello-World");
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "manual");
    assert.equal(init?.credentials, "omit");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Accept"), "application/vnd.github+json");
    assert.equal(headers.get("X-GitHub-Api-Version"), "2026-03-10");
    assert.equal(headers.get("Authorization"), null);
    assert.equal(headers.get("Cookie"), null);
    return Response.json(githubPayload);
  });
  const client = await connectClient(t);
  const { tools } = await client.listTools();
  const tool = tools.find(({ name }) => name === "get_repository_info");
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema.required, ["owner", "repo"]);
  assert.equal(tool.annotations?.readOnlyHint, true);
  assert.equal(tool.annotations?.destructiveHint, false);
  assert.equal(tool.annotations?.idempotentHint, true);
  assert.equal(tool.annotations?.openWorldHint, true);

  const result = await client.callTool({ name: "get_repository_info", arguments: { owner: "octocat", repo: "Hello-World" } });
  const expected = {
    fullName: "octocat/Hello-World",
    description: "My first repository on GitHub!",
    language: "JavaScript",
    stars: 42,
    forks: 7,
    url: "https://github.com/octocat/Hello-World",
  };
  assert.notEqual(result.isError, true);
  assert.deepEqual(result.structuredContent, expected);
  assert.deepEqual(result.content, [{ type: "text", text: JSON.stringify(expected) }]);
});

test("null descriptions and languages and zero counts are kept as GitHub reports them", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({
    ...githubPayload, description: null, language: null, stargazers_count: 0, forks_count: 0,
  }));
  assert.deepEqual(await fetchGitHubRepository({ owner: "octocat", repo: "Hello-World" }), {
    fullName: "octocat/Hello-World", description: null, language: null,
    stars: 0, forks: 0, url: "https://github.com/octocat/Hello-World",
  });
});

test("SDK tool errors never masquerade as repository data", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ message: "Not Found" }, { status: 404 }));
  const client = await connectClient(t);
  const result = await client.callTool({ name: "get_repository_info", arguments: { owner: "octocat", repo: "missing" } });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent, undefined);
  assert.ok(Array.isArray(result.content));
  const firstContent = result.content[0];
  assert.equal(firstContent.type, "text");
  assert.equal(typeof firstContent.text, "string");
  assert.match(firstContent.text, /NOT_FOUND/);
});

test("HTTP failures and rate limits have honest distinct error outcomes", async (t) => {
  for (const [status, headers, code] of [
    [403, { "X-RateLimit-Remaining": "0" }, "RATE_LIMIT"],
    [403, { "Retry-After": "60" }, "RATE_LIMIT"],
    [429, {}, "RATE_LIMIT"],
    [403, {}, "HTTP_ERROR"],
    [502, {}, "HTTP_ERROR"],
  ] as const) {
    await t.test(`${status} ${code} ${JSON.stringify(headers)}`, async (caseContext) => {
      caseContext.mock.method(globalThis, "fetch", async () => new Response("upstream failure", { status, headers }));
      await assert.rejects(() => fetchGitHubRepository({ owner: "octocat", repo: "Hello-World" }), rejectsWithCode(code));
    });
  }
});

test("redirects never fetch their target, including a private-network Location", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
    requests += 1;
    assert.equal(init?.redirect, "manual");
    return new Response(null, { status: 301, headers: { Location: "http://169.254.169.254/latest/meta-data" } });
  });
  await assert.rejects(() => fetchGitHubRepository({ owner: "octocat", repo: "Hello-World" }), rejectsWithCode("REDIRECT"));
  assert.equal(requests, 1);
});

test("unsafe path segments are rejected before any external request", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests += 1; return Response.json(githubPayload); });
  for (const input of [
    { owner: "https://github.com", repo: "repo" },
    { owner: "user@host", repo: "repo" },
    { owner: "../octocat", repo: "repo" },
    { owner: "octocat", repo: "../secret" },
    { owner: "octocat", repo: ".." },
    { owner: "octocat", repo: "%2fsecret" },
    { owner: "octocat", repo: "repo?token=secret" },
    { owner: "octocat", repo: "repo#fragment" },
    { owner: "octocat", repo: "repo\\secret" },
    { owner: "", repo: "repo" },
  ]) {
    await assert.rejects(() => fetchGitHubRepository(input), rejectsWithCode("INVALID_ARGUMENTS"));
  }
  assert.equal(requests, 0);
});

test("malformed upstream metadata is rejected rather than defaulted or coerced", async (t) => {
  for (const [name, payload] of [
    ["missing count", { ...githubPayload, forks_count: undefined }],
    ["wrong description type", { ...githubPayload, description: 12 }],
    ["negative stars", { ...githubPayload, stargazers_count: -1 }],
    ["fractional forks", { ...githubPayload, forks_count: 1.5 }],
    ["invalid URL", { ...githubPayload, html_url: "not a URL" }],
    ["non-GitHub URL", { ...githubPayload, html_url: "https://attacker.example/repo" }],
    ["URL credentials", { ...githubPayload, html_url: "https://user:secret@github.com/octocat/Hello-World" }],
  ] as const) {
    await t.test(name, async (caseContext) => {
      caseContext.mock.method(globalThis, "fetch", async () => Response.json(payload));
      await assert.rejects(() => fetchGitHubRepository({ owner: "octocat", repo: "Hello-World" }), (error: unknown) => {
        assert.ok(error instanceof GitHubRepositoryError);
        assert.equal(error.code, "INVALID_RESPONSE");
        assert.ok(error.cause instanceof Error);
        return true;
      });
    });
  }
});

test("invalid JSON preserves its parsing cause", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("{broken"));
  await assert.rejects(() => fetchGitHubRepository({ owner: "octocat", repo: "Hello-World" }), (error: unknown) => {
    assert.ok(error instanceof GitHubRepositoryError);
    assert.equal(error.code, "INVALID_RESPONSE");
    assert.ok(error.cause instanceof SyntaxError);
    return true;
  });
});

test("decoded oversized response bodies are cancelled instead of being buffered", async (t) => {
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(256 * 1024)); },
    cancel() { cancelled = true; },
  })));
  await assert.rejects(() => fetchGitHubRepository({ owner: "octocat", repo: "Hello-World" }), rejectsWithCode("INVALID_RESPONSE"));
  assert.equal(cancelled, true);
});

test("a stalled GitHub fetch is aborted before the MCP server's ten-second deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let requestSignal: AbortSignal | null | undefined;
  t.mock.method(globalThis, "fetch", (_input: unknown, init?: RequestInit) => {
    requestSignal = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      requestSignal!.addEventListener("abort", () => reject(requestSignal!.reason), { once: true });
    });
  });
  const result = fetchGitHubRepository({ owner: "octocat", repo: "Hello-World" });
  const rejected = assert.rejects(result, rejectsWithCode("TIMEOUT"));
  t.mock.timers.tick(9_999);
  await rejected;
  assert.equal(requestSignal?.aborted, true);
});

test("the deadline also aborts a stalled body after response headers arrive", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const readingBody = Promise.withResolvers<void>();
  t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
    const signal = init!.signal!;
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
      },
      pull() { readingBody.resolve(); },
    }));
  });
  const result = fetchGitHubRepository({ owner: "octocat", repo: "Hello-World" });
  const rejected = assert.rejects(result, rejectsWithCode("TIMEOUT"));
  await readingBody.promise;
  t.mock.timers.tick(9_999);
  await rejected;
});

test("caller cancellation reaches GitHub and retains its original cause", async (t) => {
  let requestSignal: AbortSignal | null | undefined;
  t.mock.method(globalThis, "fetch", (_input: unknown, init?: RequestInit) => {
    requestSignal = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      requestSignal!.addEventListener("abort", () => reject(requestSignal!.reason), { once: true });
    });
  });
  const controller = new AbortController();
  const reason = new Error("caller stopped");
  const result = fetchGitHubRepository({ owner: "octocat", repo: "Hello-World" }, controller.signal);
  const rejected = assert.rejects(result, (error: unknown) => {
    assert.ok(error instanceof GitHubRepositoryError);
    assert.equal(error.code, "CANCELLED");
    assert.equal(error.cause, reason);
    return true;
  });
  controller.abort(reason);
  await rejected;
  assert.equal(requestSignal?.aborted, true);
});

test("SDK cancellation stops the external request through the tool handler signal", async (t) => {
  const started = Promise.withResolvers<void>();
  const aborted = Promise.withResolvers<void>();
  t.mock.method(globalThis, "fetch", (_input: unknown, init?: RequestInit) => {
    const signal = init!.signal!;
    started.resolve();
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        aborted.resolve();
        reject(signal.reason);
      }, { once: true });
    });
  });
  const client = await connectClient(t);
  const controller = new AbortController();
  const result = client.callTool({
    name: "get_repository_info", arguments: { owner: "octocat", repo: "Hello-World" },
  }, undefined, { signal: controller.signal });
  const rejected = assert.rejects(result, /cancelled by caller/);
  await started.promise;
  controller.abort(new Error("cancelled by caller"));
  await rejected;
  await aborted.promise;
});

test("network errors keep the transport failure as cause", async (t) => {
  const cause = new TypeError("socket disconnected");
  t.mock.method(globalThis, "fetch", async () => { throw cause; });
  await assert.rejects(() => fetchGitHubRepository({ owner: "octocat", repo: "Hello-World" }), (error: unknown) => {
    assert.ok(error instanceof GitHubRepositoryError);
    assert.equal(error.code, "NETWORK_ERROR");
    assert.equal(error.cause, cause);
    return true;
  });
});

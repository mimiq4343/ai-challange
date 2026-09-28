import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchPipelineRepositories, PipelineSearchError } from "../src/lib/pipeline-search";
import { PIPELINE_LIMITS } from "../src/lib/pipeline-config";

const repository = {
  full_name: "octocat/Hello-World", description: "Пример", language: "TypeScript",
  stargazers_count: 42, forks_count: 7, html_url: "https://github.com/octocat/Hello-World", private: false,
};
const code = (expected: string) => (error: unknown) => error instanceof PipelineSearchError && error.code === expected;

test("search sends bounded public unauthenticated query and returns only metadata", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, "https://api.github.com/search/repositories");
    assert.equal(url.searchParams.get("q"), "typescript is:public");
    assert.equal(url.searchParams.get("per_page"), "5");
    assert.equal(new Headers(init?.headers).has("Authorization"), false);
    assert.equal(init?.redirect, "manual");
    return Response.json({ total_count: 1, incomplete_results: false, items: [repository] });
  });
  assert.deepEqual(await fetchPipelineRepositories("typescript"), [{
    fullName: "octocat/Hello-World", description: "Пример", language: "TypeScript",
    stars: 42, forks: 7, url: "https://github.com/octocat/Hello-World",
  }]);
});

test("empty search is honest data, incomplete search and private results are errors", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ total_count: 0, incomplete_results: false, items: [] }));
  assert.deepEqual(await fetchPipelineRepositories("nothing"), []);
  for (const payload of [
    { incomplete_results: true, total_count: 0, items: [] },
    { incomplete_results: false, total_count: 1, items: [{ ...repository, private: true }] },
    { incomplete_results: false, total_count: 6, items: Array(6).fill(repository) },
  ]) {
    t.mock.method(globalThis, "fetch", async () => Response.json(payload));
    await assert.rejects(fetchPipelineRepositories("test"), code("INVALID_RESPONSE"));
  }
});

test("GitHub rate limits, redirects, malformed responses and upstream failures never become empty results", async (t) => {
  for (const [status, headers, expected] of [
    [403, { "X-RateLimit-Remaining": "0" }, "RATE_LIMIT"],
    [429, {}, "RATE_LIMIT"], [403, {}, "HTTP_ERROR"], [422, {}, "HTTP_ERROR"],
    [503, {}, "HTTP_ERROR"], [302, { Location: "http://127.0.0.1" }, "REDIRECT"],
    [200, {}, "INVALID_RESPONSE"],
  ] as const) {
    t.mock.method(globalThis, "fetch", async () => new Response("bad JSON", { status, headers }));
    await assert.rejects(fetchPipelineRepositories("test"), code(expected));
  }
});

test("query validation prevents unbounded requests", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; throw new Error("unexpected remote"); });
  for (const query of ["", "   ", "a".repeat(201), "test\u0000query"]) {
    await assert.rejects(fetchPipelineRepositories(query), code("INVALID_ARGUMENTS"));
  }
  assert.equal(requests, 0);
});

test("GitHub deadlines cancel a pending network call and preserve timeout outcome", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
    const pending = Promise.withResolvers<Response>();
    init!.signal!.addEventListener("abort", () => pending.reject(init!.signal!.reason), { once: true });
    return pending.promise;
  });
  const pending = assert.rejects(fetchPipelineRepositories("test"), code("TIMEOUT"));
  t.mock.timers.tick(PIPELINE_LIMITS.searchTimeoutMs);
  await pending;
});

test("oversized decompressed JSON is rejected", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("x".repeat(2 * 1024 * 1024)));
  await assert.rejects(fetchPipelineRepositories("test"), code("INVALID_RESPONSE"));
});

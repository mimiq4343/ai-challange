import assert from "node:assert/strict";
import { test } from "node:test";
import { handleRelease } from "../src/lib/release-http";
import { consumeReleaseStream } from "../src/lib/release-stream";
import { releaseRepository } from "./helpers/release";
import type { ReleaseEvent } from "../src/lib/release-types";

function request(body: unknown, origin = "http://localhost") {
  return new Request("http://localhost/api/release", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
}

test("release boundary rejects foreign origins, unknown fields and oversized input before accessing Git or AI", async () => {
  const valid = { baseRef: "refs/heads/main", headRef: "HEAD" };
  assert.equal((await handleRelease(request(valid, "https://evil.example"))).status, 403);
  for (const input of [{}, { ...valid, root: "/etc" }, { ...valid, headRef: 3 }]) assert.equal((await handleRelease(request(input))).status, 400);
  assert.equal((await handleRelease(request({ ...valid, headRef: "a".repeat(5_000) }))).status, 413);
});

test("unknown refs produce an explicit stream error and no completed release", async t => {
  const { root } = await releaseRepository(t);
  const response = await handleRelease(request({ baseRef: "refs/heads/main", headRef: "--output=/tmp/evil" }), root);
  const events: ReleaseEvent[] = [];
  await assert.rejects(consumeReleaseStream(response.body!, event => events.push(event)), /не найдены/);
  assert.equal(events.some(event => event.type === "result"), false);
});

test("release consumer rejects a truncated stream even after a valid progress event", async () => {
  const stream = new Response(JSON.stringify({ type: "progress", message: "Working" }) + "\n").body!;
  await assert.rejects(consumeReleaseStream(stream, () => {}), /оборвался/);
});

test("release consumer parses split UTF-8 chunks and rejects malformed terminal results", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ type: "progress", message: "Релиз" }) + "\n{\"type\":\"result\",\"report\":{}}\n");
  const events: ReleaseEvent[] = [];
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
  await assert.rejects(consumeReleaseStream(stream, event => events.push(event)), /Некорректное/);
  assert.equal(events[0].type === "progress" && events[0].message, "Релиз");
});

test("provider failures never expose raw upstream details or pretend the release completed", async t => {
  const { root } = await releaseRepository(t);
  const fetcher = globalThis.fetch;
  const previous = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, OPENAI_BASE_URL: process.env.OPENAI_BASE_URL };
  t.after(() => {
    globalThis.fetch = fetcher;
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
  process.env.OPENAI_API_KEY = "test-provider-key"; process.env.OPENAI_BASE_URL = "https://provider.example/v1";
  globalThis.fetch = async url => String(url).startsWith("https://api.github.com/")
    ? Response.json({ total_count: 0, workflow_runs: [] }) : new Response("private upstream detail", { status: 500 });
  const response = await handleRelease(request({ baseRef: "refs/heads/main", headRef: "HEAD" }), root);
  const text = await response.text();
  assert.equal(text.includes("private upstream detail"), false);
  assert.equal(text.includes('"type":"result"'), false);
  assert.ok(text.includes('"type":"error"'));
});

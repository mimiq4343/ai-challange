import assert from "node:assert/strict";
import { test } from "node:test";

import type { OverflowRun, OverflowRunInput } from "../src/lib/conversation-types";
import {
  OverflowExperimentError,
  OverflowExperimentService,
} from "../src/lib/overflow-experiment";

function captureStore() {
  const runs: OverflowRun[] = [];
  return {
    runs,
    store: {
      saveOverflowRun(input: OverflowRunInput): OverflowRun {
        const run = {
          ...input,
          id: runs.length + 1,
          createdAt: "2026-09-14T00:00:00.000Z",
        };
        runs.push(run);
        return run;
      },
    },
  };
}

const buildInput = async () => ({ text: "measured input", tokens: 33_280 });
const env = { OPENROUTER_API_KEY: "test-key" };

test("requires explicit confirmation and configuration before fetch", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response();
  };
  const { store } = captureStore();

  await assert.rejects(
    new OverflowExperimentService(store, fetchImpl, env, buildInput).run({
      confirmed: false,
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      error instanceof OverflowExperimentError && error.kind === "validation",
  );
  await assert.rejects(
    new OverflowExperimentService(store, fetchImpl, {}, buildInput).run({
      confirmed: true,
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      error instanceof OverflowExperimentError && error.kind === "configuration",
  );
  assert.equal(calls, 0);
});

test("classifies one non-2xx provider response as rejected", async () => {
  let calls = 0;
  const { store, runs } = captureStore();
  const service = new OverflowExperimentService(
    store,
    async (_url, init) => {
      calls += 1;
      const request = JSON.parse(String(init?.body)) as { input: string; model: string };
      assert.equal(request.input, "measured input");
      assert.equal(request.model, "nvidia/nemotron-3-embed-1b:free");
      return Response.json(
        { error: { message: "maximum context length exceeded" } },
        { status: 400 },
      );
    },
    env,
    buildInput,
  );

  const run = await service.run({
    confirmed: true,
    signal: new AbortController().signal,
  });
  assert.equal(calls, 1);
  assert.equal(run.outcome, "rejected");
  assert.equal(run.httpStatus, 400);
  assert.equal(runs.length, 1);
  assert.equal("input" in run, false);
  assert.equal("embedding" in run, false);
});

test("distinguishes provider truncation from accepted oversized input", async () => {
  for (const [promptTokens, expected] of [
    [32_768, "truncated"],
    [33_280, "accepted"],
  ] as const) {
    const { store } = captureStore();
    const service = new OverflowExperimentService(
      store,
      async () =>
        Response.json({
          data: [{ embedding: [0.1, 0.2] }],
          usage: { prompt_tokens: promptTokens, total_tokens: promptTokens },
        }),
      env,
      buildInput,
    );

    const run = await service.run({
      confirmed: true,
      signal: new AbortController().signal,
    });
    assert.equal(run.outcome, expected);
    assert.equal(run.providerInputTokens, promptTokens);
  }
});

test("persists a single network_error without retry", async () => {
  let calls = 0;
  const { store, runs } = captureStore();
  const service = new OverflowExperimentService(
    store,
    async () => {
      calls += 1;
      throw new TypeError("network unavailable");
    },
    env,
    buildInput,
  );

  const run = await service.run({
    confirmed: true,
    signal: new AbortController().signal,
  });
  assert.equal(calls, 1);
  assert.equal(run.outcome, "network_error");
  assert.equal(run.httpStatus, null);
  assert.equal(runs.length, 1);
});

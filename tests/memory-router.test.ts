import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MemoryRouterError,
  buildMemoryRouterPrompt,
  parseMemoryRouterResponse,
  runMemoryRouter,
} from "../src/lib/memory-router";
import type { MemoryRouterCompletion, MemoryRouterLlm } from "../src/lib/memory-router-llm";

function stubRouter(completion: MemoryRouterCompletion): MemoryRouterLlm {
  return {
    model: "deepseek-v4-flash",
    async complete() {
      return completion;
    },
  };
}

test("parses layered writes and drops malformed entries", () => {
  const result = parseMemoryRouterResponse(`{
    "task": { "title": "Модель памяти", "goal": "Разделить слои" },
    "closeTask": false,
    "writes": [
      { "layer": "long_term", "kind": "profile", "key": "language", "value": "TypeScript", "reason": "основной язык" },
      { "layer": "long_term", "kind": "unknown", "key": "x", "value": "y", "reason": null },
      { "layer": "working", "kind": "step", "value": "Описать слои", "reason": null },
      { "layer": "working", "kind": "step", "reason": null },
      { "layer": "short_term", "kind": "fact", "value": "нельзя", "reason": null }
    ]
  }`);

  assert.deepEqual(result.task, { title: "Модель памяти", goal: "Разделить слои" });
  assert.equal(result.closeTask, false);
  assert.equal(result.writes.length, 2);
  assert.deepEqual(
    result.writes.map((write) => write.layer),
    ["long_term", "working"],
  );
});

test("accepts a decision to write nothing", () => {
  const result = parseMemoryRouterResponse('{"task": null, "closeTask": false, "writes": []}');
  assert.equal(result.task, null);
  assert.equal(result.writes.length, 0);
});

test("rejects a response without a JSON object", () => {
  assert.throws(() => parseMemoryRouterResponse("нет данных"), MemoryRouterError);
  assert.throws(() => parseMemoryRouterResponse("{нет: данных}"), MemoryRouterError);
});

test("router prompt exposes existing keys and the active task", () => {
  const prompt = buildMemoryRouterPrompt({
    request: "Запомни, что дедлайн в пятницу",
    response: "Запомнил",
    working: {
      task: {
        id: 1,
        conversationId: "c",
        title: "Релиз",
        goal: "Выпустить Day 11",
        status: "active",
        createdAt: "2026-09-20T10:00:00.000Z",
        updatedAt: "2026-09-20T10:00:00.000Z",
      },
      slots: [
        {
          id: 1,
          taskId: 1,
          kind: "step",
          value: "Собрать инспектор",
          origin: "router",
          reason: null,
          createdAt: "2026-09-20T10:00:00.000Z",
        },
      ],
    },
    longTermKeys: ["language", "favourite_color"],
  });

  assert.match(prompt, /language, favourite_color/);
  assert.match(prompt, /Релиз — Выпустить Day 11/);
  assert.match(prompt, /step: Собрать инспектор/);
  assert.match(prompt, /дедлайн в пятницу/);
});

test("router result carries provider cost when usage is reported", async () => {
  const result = await runMemoryRouter({
    llm: stubRouter({
      content: '{"task": null, "closeTask": false, "writes": []}',
      usage: {
        promptTokens: 1_000,
        completionTokens: 100,
        totalTokens: 1_100,
        cacheHitTokens: 0,
        cacheMissTokens: 1_000,
      },
    }),
    request: "Привет",
    response: "Привет",
    working: null,
    longTermKeys: [],
  });

  assert.equal(result.cost?.promptTokens, 1_000);
  assert.ok((result.cost?.costMicrosUsd ?? 0) > 0);
});

test("router result without provider usage reports no cost", async () => {
  const result = await runMemoryRouter({
    llm: stubRouter({
      content: '{"task": null, "closeTask": false, "writes": []}',
      usage: null,
    }),
    request: "Привет",
    response: "Привет",
    working: null,
    longTermKeys: [],
  });

  assert.equal(result.cost, null);
});

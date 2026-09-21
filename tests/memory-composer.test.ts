import assert from "node:assert/strict";
import { test } from "node:test";

import {
  composeMemoryPrompt,
  countMemoryPromptTokens,
  SHORT_TERM_WINDOW_MESSAGES,
} from "../src/lib/memory-composer";
import type { StoredMessage } from "../src/lib/conversation-types";
import { DEEPSEEK_FLASH_PROFILE } from "../src/lib/model-profiles";
import type { LongTermEntry, WorkingMemory } from "../src/lib/memory-types";

function storedMessages(count: number): StoredMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    conversationId: "conversation",
    role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `Сообщение ${index + 1}`,
    createdAt: "2026-09-20T10:00:00.000Z",
  }));
}

function longTermEntry(id: number, key: string, value: string): LongTermEntry {
  return {
    id,
    profileId: 1,
    kind: "profile",
    key,
    value,
    origin: "router",
    reason: null,
    sourceConversationId: null,
    createdAt: "2026-09-20T10:00:00.000Z",
    updatedAt: "2026-09-20T10:00:00.000Z",
  };
}

const working: WorkingMemory = {
  task: {
    id: 1,
    conversationId: "conversation",
    title: "Модель памяти",
    goal: "Разделить слои",
    status: "active",
    createdAt: "2026-09-20T10:00:00.000Z",
    updatedAt: "2026-09-20T10:00:00.000Z",
  },
  slots: [
    {
      id: 1,
      taskId: 1,
      kind: "constraint",
      value: "Без сторонних зависимостей",
      origin: "router",
      reason: null,
      createdAt: "2026-09-20T10:00:00.000Z",
    },
  ],
};

test("short term memory keeps only the last window of messages", async () => {
  const composed = await composeMemoryPrompt({
    profile: null,
    messages: storedMessages(20),
    longTerm: [],
    working: null,
    layers: {
      shortTerm: true,
      working: true,
      longTerm: true,
      profile: false,
      task: false,
      invariants: false,
    },
  });

  assert.equal(composed.history.length, SHORT_TERM_WINDOW_MESSAGES);
  assert.equal(composed.history[0].content, "Сообщение 13");
  assert.equal(composed.history.at(-1)?.content, "Сообщение 20");
  assert.equal(composed.totalMessages, 20);
});

test("disabled layers drop their blocks and cost zero tokens", async () => {
  const messages = storedMessages(4);
  const longTerm = [longTermEntry(1, "favourite_color", "синий")];

  const enabled = await composeMemoryPrompt({
    profile: null,
    messages,
    longTerm,
    working,
    layers: {
      shortTerm: true,
      working: true,
      longTerm: true,
      profile: false,
      task: false,
      invariants: false,
    },
  });
  const disabled = await composeMemoryPrompt({
    profile: null,
    messages,
    longTerm,
    working,
    layers: {
      shortTerm: false,
      working: false,
      longTerm: false,
      profile: false,
      task: false,
      invariants: false,
    },
  });

  assert.equal(enabled.systemMessages.length, 3);
  assert.equal(disabled.systemMessages.length, 1);
  assert.equal(disabled.longTermBlock, null);
  assert.equal(disabled.workingBlock, null);
  assert.equal(disabled.history.length, 0);
  assert.equal(disabled.skippedLongTerm.length, 1);

  const disabledTokens = await countMemoryPromptTokens({
    composed: disabled,
    request: "Какой у меня любимый цвет?",
  });
  assert.equal(disabledTokens.longTermTokens, 0);
  assert.equal(disabledTokens.workingTokens, 0);
  assert.equal(disabledTokens.shortTermTokens, 0);

  const enabledTokens = await countMemoryPromptTokens({
    composed: enabled,
    request: "Какой у меня любимый цвет?",
  });
  assert.ok(enabledTokens.longTermTokens > 0);
  assert.ok(enabledTokens.workingTokens > 0);
  assert.ok(enabledTokens.shortTermTokens > 0);
  assert.equal(
    enabledTokens.systemTokens +
      enabledTokens.longTermTokens +
      enabledTokens.workingTokens +
      enabledTokens.shortTermTokens +
      enabledTokens.requestTokens,
    enabledTokens.promptTokens,
  );
  assert.equal(
    enabledTokens.contextTokens,
    enabledTokens.promptTokens + DEEPSEEK_FLASH_PROFILE.responseReserveTokens,
  );
});

test("long term budget keeps the freshest entries and reports the rest as skipped", async () => {
  const bulky = Array.from({ length: 60 }, (_, index) =>
    longTermEntry(
      index + 1,
      `key_${index}`,
      "Развёрнутое значение долговременной памяти, занимающее заметное число токенов. ".repeat(3),
    ),
  );

  const composed = await composeMemoryPrompt({
    profile: null,
    messages: [],
    longTerm: bulky,
    working: null,
    layers: {
      shortTerm: true,
      working: true,
      longTerm: true,
      profile: false,
      task: false,
      invariants: false,
    },
  });

  assert.ok(composed.includedLongTerm.length > 0);
  assert.ok(composed.skippedLongTerm.length > 0);
  assert.equal(
    composed.includedLongTerm.length + composed.skippedLongTerm.length,
    bulky.length,
  );
  assert.equal(composed.includedLongTerm[0].key, "key_0");

  const tokens = await countMemoryPromptTokens({ composed, request: "Что ты помнишь?" });
  assert.ok(tokens.longTermTokens <= 2_100);
});

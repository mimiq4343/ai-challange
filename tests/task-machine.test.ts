import assert from "node:assert/strict";
import { test } from "node:test";

import {
  allowedTransitions,
  checkTransition,
  defaultExpectation,
  isTerminalStage,
  TASK_STAGES,
  type TaskStage,
} from "../src/lib/task-machine";

const ALLOWED: Array<[TaskStage, TaskStage]> = [
  ["planning", "execution"],
  ["planning", "cancelled"],
  ["execution", "validation"],
  ["execution", "blocked"],
  ["execution", "cancelled"],
  ["validation", "done"],
  ["validation", "execution"],
  ["validation", "blocked"],
  ["validation", "cancelled"],
  ["blocked", "execution"],
  ["blocked", "validation"],
  ["blocked", "cancelled"],
];

test("only the documented transitions are allowed", () => {
  for (const from of TASK_STAGES) {
    for (const to of TASK_STAGES) {
      if (from === to) continue;
      const expected = ALLOWED.some(([a, b]) => a === from && b === to);
      const actual = checkTransition({
        from,
        to,
        paused: false,
        origin: "user",
        blockedFrom: from === "blocked" ? to : null,
      }).allowed;
      assert.equal(
        actual,
        expected,
        `${from} → ${to}: ожидалось ${expected}, получено ${actual}`,
      );
    }
  }
});

test("terminal stages accept nothing", () => {
  assert.equal(isTerminalStage("done"), true);
  assert.equal(isTerminalStage("cancelled"), true);
  assert.equal(allowedTransitions("done").length, 0);
  assert.equal(
    checkTransition({ from: "done", to: "execution", paused: false, origin: "user" })
      .allowed,
    false,
  );
});

test("a paused task rejects agent transitions but obeys the user", () => {
  const byAgent = checkTransition({
    from: "execution",
    to: "validation",
    paused: true,
    origin: "agent",
  });
  assert.equal(byAgent.allowed, false);
  assert.match(byAgent.allowed ? "" : byAgent.reason, /пауз/i);

  assert.equal(
    checkTransition({ from: "execution", to: "validation", paused: true, origin: "user" })
      .allowed,
    true,
  );
});

test("a blocked task returns only to the stage it left", () => {
  assert.equal(
    checkTransition({
      from: "blocked",
      to: "validation",
      paused: false,
      origin: "agent",
      blockedFrom: "execution",
    }).allowed,
    false,
  );
  assert.equal(
    checkTransition({
      from: "blocked",
      to: "execution",
      paused: false,
      origin: "agent",
      blockedFrom: "execution",
    }).allowed,
    true,
  );
  assert.equal(
    checkTransition({
      from: "blocked",
      to: "cancelled",
      paused: false,
      origin: "user",
      blockedFrom: "execution",
    }).allowed,
    true,
  );
});

test("implementation needs a non-empty approved plan", () => {
  const empty = checkTransition({
    from: "planning",
    to: "execution",
    paused: false,
    origin: "user",
    context: { planApproved: false, totalSteps: 0, openSteps: 0 },
  });
  assert.equal(empty.allowed, false);
  assert.match(empty.allowed ? "" : empty.reason, /Плана нет/);

  const unapproved = checkTransition({
    from: "planning",
    to: "execution",
    paused: false,
    origin: "agent",
    context: { planApproved: false, totalSteps: 3, openSteps: 3 },
  });
  assert.equal(unapproved.allowed, false);
  assert.match(unapproved.allowed ? "" : unapproved.reason, /не утверждён/);

  assert.equal(
    checkTransition({
      from: "planning",
      to: "execution",
      paused: false,
      origin: "agent",
      context: { planApproved: true, totalSteps: 3, openSteps: 3 },
    }).allowed,
    true,
  );
});

test("validation needs every step closed and the finish needs a human", () => {
  const open = checkTransition({
    from: "execution",
    to: "validation",
    paused: false,
    origin: "agent",
    context: { planApproved: true, totalSteps: 3, openSteps: 2 },
  });
  assert.equal(open.allowed, false);
  assert.match(open.allowed ? "" : open.reason, /Осталось незакрытых шагов: 2/);

  assert.equal(
    checkTransition({
      from: "execution",
      to: "validation",
      paused: false,
      origin: "agent",
      context: { planApproved: true, totalSteps: 3, openSteps: 0 },
    }).allowed,
    true,
  );

  const byAgent = checkTransition({
    from: "validation",
    to: "done",
    paused: false,
    origin: "agent",
    context: { planApproved: true, totalSteps: 3, openSteps: 0 },
  });
  assert.equal(byAgent.allowed, false);
  assert.match(byAgent.allowed ? "" : byAgent.reason, /Финал принимает человек/);

  assert.equal(
    checkTransition({
      from: "validation",
      to: "done",
      paused: false,
      origin: "user",
      context: { planApproved: true, totalSteps: 3, openSteps: 0 },
    }).allowed,
    true,
  );
});

test("every stage names who acts next", () => {
  assert.equal(defaultExpectation("execution").actor, "agent");
  assert.equal(defaultExpectation("validation").actor, "user");
  for (const stage of TASK_STAGES) {
    assert.ok(defaultExpectation(stage).action.length > 0);
  }
});

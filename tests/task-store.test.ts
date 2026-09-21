import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { SqliteProfileStore } from "../src/lib/profile-store";
import { SqliteTaskStore, TaskTransitionError } from "../src/lib/task-store";

const temporaryDirectories: string[] = [];

after(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createStores() {
  const directory = await mkdtemp(join(tmpdir(), "flash-task-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "chat.sqlite");
  const profiles = new SqliteProfileStore(databasePath);
  const tasks = new SqliteTaskStore(databasePath);
  return { profiles, tasks, profileId: profiles.getActiveProfile().id };
}

test("a profile keeps at most one live task", async () => {
  const { profiles, tasks, profileId } = await createStores();
  const run = tasks.createRun(profileId, "Первая задача", "Проверить автомат");

  assert.equal(run.stage, "planning");
  assert.equal(run.paused, false);
  assert.equal(run.expectedActor, "agent");
  assert.throws(() => tasks.createRun(profileId, "Вторая задача", null));

  tasks.transition({ runId: run.id, to: "cancelled", origin: "user", reason: null });
  assert.equal(tasks.getLiveRun(profileId), null);
  const second = tasks.createRun(profileId, "Вторая задача", null);
  assert.notEqual(second.id, run.id);

  tasks.close();
  profiles.close();
});

test("steps move the pointer and record the plan", async () => {
  const { profiles, tasks, profileId } = await createStores();
  const run = tasks.createRun(profileId, "Модель задачи", null);

  const first = tasks.addStep(run.id, "Собрать требования");
  const second = tasks.addStep(run.id, "Спроектировать схему");
  assert.equal(first.status, "active");
  assert.equal(second.status, "pending");
  assert.equal(tasks.getRun(run.id)?.currentStepId, first.id);

  tasks.updateStep({ runId: run.id, stepId: first.id, status: "done", origin: "user" });
  const steps = tasks.listSteps(run.id);
  assert.deepEqual(
    steps.map((step) => step.status),
    ["done", "active"],
  );
  assert.equal(tasks.getRun(run.id)?.currentStepId, second.id);

  tasks.close();
  profiles.close();
});

test("a paused task rejects agent updates and logs them", async () => {
  const { profiles, tasks, profileId } = await createStores();
  const run = tasks.createRun(profileId, "Пауза", null);
  tasks.transition({ runId: run.id, to: "execution", origin: "user", reason: null });
  tasks.addStep(run.id, "Первый шаг");
  tasks.setPaused(run.id, true);

  const outcome = tasks.applyAgentUpdate(
    run.id,
    {
      transition: "validation",
      completedSteps: [1],
      newSteps: [],
      expectedActor: null,
      expectedAction: null,
      block: null,
    },
    { conversationId: null, assistantMessageId: null },
  );

  assert.equal(outcome.applied, false);
  assert.match(outcome.rejectedReason ?? "", /пауз/i);
  assert.equal(tasks.getRun(run.id)?.stage, "execution");
  assert.equal(tasks.listSteps(run.id)[0].status, "active");
  assert.equal(tasks.listEvents(run.id)[0].kind, "rejected");

  const resumed = tasks.setPaused(run.id, false);
  assert.equal(resumed.paused, false);
  assert.equal(resumed.expectedActor, "agent");
  const afterResume = tasks.applyAgentUpdate(
    run.id,
    {
      transition: "validation",
      completedSteps: [1],
      newSteps: [],
      expectedActor: null,
      expectedAction: null,
      block: null,
    },
    { conversationId: null, assistantMessageId: null },
  );
  assert.equal(afterResume.applied, true);
  assert.equal(tasks.getRun(run.id)?.stage, "validation");
  assert.equal(tasks.listSteps(run.id)[0].status, "done");

  tasks.close();
  profiles.close();
});

test("the agent plans only while planning and blocking remembers the stage", async () => {
  const { profiles, tasks, profileId } = await createStores();
  const run = tasks.createRun(profileId, "План", null);

  tasks.applyAgentUpdate(
    run.id,
    {
      transition: "execution",
      completedSteps: [],
      newSteps: ["Шаг один", "Шаг два"],
      expectedActor: "agent",
      expectedAction: "выполнить первый шаг",
      block: null,
    },
    { conversationId: null, assistantMessageId: null },
  );
  assert.equal(tasks.listSteps(run.id).length, 2);
  assert.equal(tasks.getRun(run.id)?.stage, "execution");
  assert.equal(tasks.getRun(run.id)?.expectedAction, "выполнить первый шаг");

  tasks.applyAgentUpdate(
    run.id,
    {
      transition: null,
      completedSteps: [],
      newSteps: ["Лишний шаг вне планирования"],
      expectedActor: null,
      expectedAction: null,
      block: "ждём доступ к базе",
    },
    { conversationId: null, assistantMessageId: null },
  );
  const blocked = tasks.getRun(run.id);
  assert.equal(tasks.listSteps(run.id).length, 2);
  assert.equal(blocked?.stage, "blocked");
  assert.equal(blocked?.blockedFrom, "execution");
  assert.equal(blocked?.blockedReason, "ждём доступ к базе");

  const wrongReturn = tasks.transition({
    runId: run.id,
    to: "validation",
    origin: "agent",
    reason: null,
  });
  assert.equal(wrongReturn.applied, false);
  assert.equal(
    tasks.transition({ runId: run.id, to: "execution", origin: "agent", reason: null })
      .applied,
    true,
  );

  tasks.close();
  profiles.close();
});

test("finished tasks cannot be paused or moved", async () => {
  const { profiles, tasks, profileId } = await createStores();
  const run = tasks.createRun(profileId, "Финал", null);
  tasks.transition({ runId: run.id, to: "execution", origin: "user", reason: null });
  tasks.transition({ runId: run.id, to: "validation", origin: "user", reason: null });
  tasks.transition({ runId: run.id, to: "done", origin: "user", reason: null });

  assert.equal(tasks.getRun(run.id)?.stage, "done");
  assert.equal(tasks.getLiveRun(profileId), null);
  assert.throws(() => tasks.setPaused(run.id, true), TaskTransitionError);
  assert.equal(
    tasks.transition({ runId: run.id, to: "execution", origin: "user", reason: null })
      .applied,
    false,
  );

  tasks.close();
  profiles.close();
});

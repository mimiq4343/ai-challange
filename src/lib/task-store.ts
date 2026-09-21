import { join } from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";

import { ensureMemorySchema } from "./memory-schema";
import { openChatDatabase, releaseChatDatabase } from "./sqlite-database";
import {
  checkTransition,
  defaultExpectation,
  isTerminalStage,
  type TaskActor,
  type TaskStage,
} from "./task-machine";
import type {
  TaskEvent,
  TaskEventKind,
  TaskRun,
  TaskSnapshot,
  TaskStateUpdate,
  TaskStep,
  TaskStepStatus,
  TaskUpdateOutcome,
} from "./task-types";

const EVENT_LOG_LIMIT = 40;

type RunRow = {
  id: number;
  profile_id: number;
  title: string;
  goal: string | null;
  stage: TaskStage;
  paused: number;
  expected_actor: TaskActor;
  expected_action: string;
  blocked_from: TaskStage | null;
  blocked_reason: string | null;
  current_step_id: number | null;
  created_at: string;
  updated_at: string;
};

type StepRow = {
  id: number;
  run_id: number;
  position: number;
  title: string;
  status: TaskStepStatus;
  result: string | null;
  created_at: string;
  updated_at: string;
};

type EventRow = {
  id: number;
  run_id: number;
  kind: TaskEventKind;
  origin: TaskActor;
  from_stage: TaskStage | null;
  to_stage: TaskStage | null;
  reason: string | null;
  conversation_id: string | null;
  created_at: string;
};

export class TaskNotFoundError extends Error {
  constructor(readonly runId: number) {
    super(`Задача ${runId} не найдена.`);
    this.name = "TaskNotFoundError";
  }
}

export class TaskTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskTransitionError";
  }
}

export type TaskJournalContext = {
  conversationId: string | null;
  assistantMessageId: number | null;
};

function toRun(row: RunRow): TaskRun {
  return {
    id: row.id,
    profileId: row.profile_id,
    title: row.title,
    goal: row.goal,
    stage: row.stage,
    paused: row.paused === 1,
    expectedActor: row.expected_actor,
    expectedAction: row.expected_action,
    blockedFrom: row.blocked_from,
    blockedReason: row.blocked_reason,
    currentStepId: row.current_step_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toStep(row: StepRow): TaskStep {
  return {
    id: row.id,
    runId: row.run_id,
    position: row.position,
    title: row.title,
    status: row.status,
    result: row.result,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteTaskStore {
  private readonly database: DatabaseSync;
  private readonly databasePath: string;
  private readonly getLiveRunStatement: StatementSync;
  private readonly getRunStatement: StatementSync;
  private readonly insertRunStatement: StatementSync;
  private readonly updateRunStateStatement: StatementSync;
  private readonly setPausedStatement: StatementSync;
  private readonly setCurrentStepStatement: StatementSync;
  private readonly listStepsStatement: StatementSync;
  private readonly nextPositionStatement: StatementSync;
  private readonly insertStepStatement: StatementSync;
  private readonly updateStepStatement: StatementSync;
  private readonly deleteStepStatement: StatementSync;
  private readonly insertEventStatement: StatementSync;
  private readonly listEventsStatement: StatementSync;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
    this.database = openChatDatabase(databasePath);
    ensureMemorySchema(this.database);

    const runColumns = `id, profile_id, title, goal, stage, paused, expected_actor,
                        expected_action, blocked_from, blocked_reason, current_step_id,
                        created_at, updated_at`;
    this.getLiveRunStatement = this.database.prepare(`
      SELECT ${runColumns} FROM task_runs
      WHERE profile_id = ?
        AND stage IN ('planning', 'execution', 'validation', 'blocked')
    `);
    this.getRunStatement = this.database.prepare(`
      SELECT ${runColumns} FROM task_runs WHERE id = ?
    `);
    this.insertRunStatement = this.database.prepare(`
      INSERT INTO task_runs (
        profile_id, title, goal, stage, paused, expected_actor, expected_action,
        blocked_from, blocked_reason, current_step_id, created_at, updated_at
      ) VALUES (?, ?, ?, 'planning', 0, ?, ?, NULL, NULL, NULL, ?, ?)
      RETURNING ${runColumns}
    `);
    this.updateRunStateStatement = this.database.prepare(`
      UPDATE task_runs
      SET stage = ?, expected_actor = ?, expected_action = ?, blocked_from = ?,
          blocked_reason = ?, updated_at = ?
      WHERE id = ?
      RETURNING ${runColumns}
    `);
    this.setPausedStatement = this.database.prepare(`
      UPDATE task_runs
      SET paused = ?, expected_actor = ?, expected_action = ?, updated_at = ?
      WHERE id = ?
      RETURNING ${runColumns}
    `);
    this.setCurrentStepStatement = this.database.prepare(`
      UPDATE task_runs SET current_step_id = ?, updated_at = ? WHERE id = ?
    `);
    this.listStepsStatement = this.database.prepare(`
      SELECT id, run_id, position, title, status, result, created_at, updated_at
      FROM task_steps
      WHERE run_id = ?
      ORDER BY position ASC
    `);
    this.nextPositionStatement = this.database.prepare(`
      SELECT COALESCE(MAX(position), 0) + 1 AS position FROM task_steps WHERE run_id = ?
    `);
    this.insertStepStatement = this.database.prepare(`
      INSERT INTO task_steps (run_id, position, title, status, result, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?, ?)
      RETURNING id, run_id, position, title, status, result, created_at, updated_at
    `);
    this.updateStepStatement = this.database.prepare(`
      UPDATE task_steps
      SET status = ?, result = ?, updated_at = ?
      WHERE id = ? AND run_id = ?
      RETURNING id, run_id, position, title, status, result, created_at, updated_at
    `);
    this.deleteStepStatement = this.database.prepare(`
      DELETE FROM task_steps WHERE id = ? AND run_id = ?
    `);
    this.insertEventStatement = this.database.prepare(`
      INSERT INTO task_events (
        run_id, kind, origin, from_stage, to_stage, reason, conversation_id,
        assistant_message_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.listEventsStatement = this.database.prepare(`
      SELECT id, run_id, kind, origin, from_stage, to_stage, reason, conversation_id,
             created_at
      FROM task_events
      WHERE run_id = ?
      ORDER BY id DESC
      LIMIT ?
    `);
  }

  getLiveRun(profileId: number): TaskRun | null {
    const row = this.getLiveRunStatement.get(profileId) as RunRow | undefined;
    return row ? toRun(row) : null;
  }

  getRun(runId: number): TaskRun | null {
    const row = this.getRunStatement.get(runId) as RunRow | undefined;
    return row ? toRun(row) : null;
  }

  listSteps(runId: number): TaskStep[] {
    return (this.listStepsStatement.all(runId) as StepRow[]).map(toStep);
  }

  listEvents(runId: number, limit: number = EVENT_LOG_LIMIT): TaskEvent[] {
    return (this.listEventsStatement.all(runId, limit) as EventRow[]).map((row) => ({
      id: row.id,
      runId: row.run_id,
      kind: row.kind,
      origin: row.origin,
      fromStage: row.from_stage,
      toStage: row.to_stage,
      reason: row.reason,
      conversationId: row.conversation_id,
      createdAt: row.created_at,
    }));
  }

  getSnapshot(profileId: number): TaskSnapshot | null {
    const run = this.getLiveRun(profileId);
    if (!run) return null;
    return { run, steps: this.listSteps(run.id), events: this.listEvents(run.id) };
  }

  createRun(profileId: number, title: string, goal: string | null): TaskRun {
    const timestamp = new Date().toISOString();
    const expectation = defaultExpectation("planning");
    const row = this.insertRunStatement.get(
      profileId,
      title,
      goal,
      expectation.actor,
      expectation.action,
      timestamp,
      timestamp,
    ) as RunRow;
    this.recordEvent(row.id, {
      kind: "transition",
      origin: "user",
      fromStage: null,
      toStage: "planning",
      reason: "задача создана",
      journal: { conversationId: null, assistantMessageId: null },
    });
    return toRun(row);
  }

  private recordEvent(
    runId: number,
    input: {
      kind: TaskEventKind;
      origin: TaskActor;
      fromStage: TaskStage | null;
      toStage: TaskStage | null;
      reason: string | null;
      journal: TaskJournalContext;
    },
  ): void {
    this.insertEventStatement.run(
      runId,
      input.kind,
      input.origin,
      input.fromStage,
      input.toStage,
      input.reason,
      input.journal.conversationId,
      input.journal.assistantMessageId,
      new Date().toISOString(),
    );
  }

  /**
   * Выполняет переход автомата. Недопустимый переход не меняет состояние и
   * попадает в журнал как `rejected`.
   */
  transition(input: {
    runId: number;
    to: TaskStage;
    origin: TaskActor;
    reason: string | null;
    blockReason?: string | null;
    journal?: TaskJournalContext;
  }): TaskUpdateOutcome {
    const run = this.getRun(input.runId);
    if (!run) throw new TaskNotFoundError(input.runId);

    const journal = input.journal ?? { conversationId: null, assistantMessageId: null };
    const check = checkTransition({
      from: run.stage,
      to: input.to,
      paused: run.paused,
      origin: input.origin,
      blockedFrom: run.blockedFrom,
    });

    if (!check.allowed) {
      this.recordEvent(run.id, {
        kind: "rejected",
        origin: input.origin,
        fromStage: run.stage,
        toStage: input.to,
        reason: check.reason,
        journal,
      });
      return { applied: false, rejectedReason: check.reason, stage: run.stage };
    }

    const expectation = defaultExpectation(input.to);
    const blockedFrom = input.to === "blocked" ? run.stage : null;
    this.updateRunStateStatement.run(
      input.to,
      expectation.actor,
      expectation.action,
      blockedFrom,
      input.to === "blocked" ? (input.blockReason ?? input.reason) : null,
      new Date().toISOString(),
      run.id,
    );
    this.recordEvent(run.id, {
      kind: "transition",
      origin: input.origin,
      fromStage: run.stage,
      toStage: input.to,
      reason: input.reason,
      journal,
    });

    return { applied: true, rejectedReason: null, stage: input.to };
  }

  setPaused(runId: number, paused: boolean, journal?: TaskJournalContext): TaskRun {
    const run = this.getRun(runId);
    if (!run) throw new TaskNotFoundError(runId);
    if (isTerminalStage(run.stage)) {
      throw new TaskTransitionError(`Этап ${run.stage} терминальный: пауза не нужна.`);
    }

    const expectation = paused
      ? { actor: "user" as TaskActor, action: "возобновить задачу" }
      : defaultExpectation(run.stage);
    const row = this.setPausedStatement.get(
      paused ? 1 : 0,
      expectation.actor,
      expectation.action,
      new Date().toISOString(),
      runId,
    ) as RunRow;
    this.recordEvent(runId, {
      kind: paused ? "pause" : "resume",
      origin: "user",
      fromStage: run.stage,
      toStage: run.stage,
      reason: paused ? "поставлено на паузу" : "возобновлено",
      journal: journal ?? { conversationId: null, assistantMessageId: null },
    });

    return toRun(row);
  }

  addStep(runId: number, title: string, journal?: TaskJournalContext): TaskStep {
    const run = this.getRun(runId);
    if (!run) throw new TaskNotFoundError(runId);

    const timestamp = new Date().toISOString();
    const { position } = this.nextPositionStatement.get(runId) as { position: number };
    const hasActive = this.listSteps(runId).some((step) => step.status === "active");
    const row = this.insertStepStatement.get(
      runId,
      position,
      title,
      hasActive ? "pending" : "active",
      timestamp,
      timestamp,
    ) as StepRow;
    if (!hasActive) this.setCurrentStepStatement.run(row.id, timestamp, runId);
    this.recordEvent(runId, {
      kind: "step",
      origin: "user",
      fromStage: run.stage,
      toStage: run.stage,
      reason: `добавлен шаг ${position}: ${title}`,
      journal: journal ?? { conversationId: null, assistantMessageId: null },
    });

    return toStep(row);
  }

  /**
   * Меняет статус шага и переносит указатель на следующий незакрытый шаг.
   */
  updateStep(input: {
    runId: number;
    stepId: number;
    status: TaskStepStatus;
    result?: string | null;
    origin: TaskActor;
    journal?: TaskJournalContext;
  }): TaskStep {
    const run = this.getRun(input.runId);
    if (!run) throw new TaskNotFoundError(input.runId);

    const timestamp = new Date().toISOString();
    const row = this.updateStepStatement.get(
      input.status,
      input.result ?? null,
      timestamp,
      input.stepId,
      input.runId,
    ) as StepRow | undefined;
    if (!row) throw new TaskNotFoundError(input.stepId);

    const steps = this.listSteps(input.runId);
    const next = steps.find((step) => step.status === "pending" || step.status === "active");
    if (next && next.status === "pending") {
      this.updateStepStatement.run("active", next.result, timestamp, next.id, input.runId);
    }
    this.setCurrentStepStatement.run(next?.id ?? null, timestamp, input.runId);
    this.recordEvent(input.runId, {
      kind: "step",
      origin: input.origin,
      fromStage: run.stage,
      toStage: run.stage,
      reason: `шаг ${row.position} → ${input.status}`,
      journal: input.journal ?? { conversationId: null, assistantMessageId: null },
    });

    return toStep(row);
  }

  deleteStep(runId: number, stepId: number): boolean {
    return this.deleteStepStatement.run(stepId, runId).changes > 0;
  }

  /**
   * Применяет предложение агента одной транзакцией: план на этапе planning,
   * отметки выполненных шагов, ожидаемое действие и переход.
   */
  applyAgentUpdate(
    runId: number,
    update: TaskStateUpdate,
    journal: TaskJournalContext,
  ): TaskUpdateOutcome {
    const run = this.getRun(runId);
    if (!run) throw new TaskNotFoundError(runId);

    this.database.exec("BEGIN IMMEDIATE");
    let outcome: TaskUpdateOutcome = {
      applied: false,
      rejectedReason: null,
      stage: run.stage,
    };
    try {
      if (run.paused) {
        this.recordEvent(runId, {
          kind: "rejected",
          origin: "agent",
          fromStage: run.stage,
          toStage: update.transition,
          reason: "Задача на паузе: обновления агента не применяются.",
          journal,
        });
        this.database.exec("COMMIT");
        return {
          applied: false,
          rejectedReason: "Задача на паузе: обновления агента не применяются.",
          stage: run.stage,
        };
      }

      if (run.stage === "planning") {
        for (const title of update.newSteps) this.addStep(runId, title, journal);
      }

      for (const position of update.completedSteps) {
        const step = this.listSteps(runId).find((item) => item.position === position);
        if (!step || step.status === "done") continue;
        this.updateStep({
          runId,
          stepId: step.id,
          status: "done",
          origin: "agent",
          journal,
        });
      }

      if (update.block) {
        outcome = this.transition({
          runId,
          to: "blocked",
          origin: "agent",
          reason: update.block,
          blockReason: update.block,
          journal,
        });
      } else if (update.transition) {
        outcome = this.transition({
          runId,
          to: update.transition,
          origin: "agent",
          reason: "предложено агентом",
          journal,
        });
      }

      if (update.expectedActor && update.expectedAction) {
        const current = this.getRun(runId) as TaskRun;
        this.updateRunStateStatement.run(
          current.stage,
          update.expectedActor,
          update.expectedAction,
          current.blockedFrom,
          current.blockedReason,
          new Date().toISOString(),
          runId,
        );
      }

      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }

    return outcome;
  }

  close(): void {
    releaseChatDatabase(this.databasePath);
  }
}

const globalForTaskStore = globalThis as typeof globalThis & {
  taskStore?: SqliteTaskStore;
};

export function getTaskStore(): SqliteTaskStore {
  globalForTaskStore.taskStore ??= new SqliteTaskStore(
    join(process.cwd(), "data", "chat.sqlite"),
  );
  return globalForTaskStore.taskStore;
}

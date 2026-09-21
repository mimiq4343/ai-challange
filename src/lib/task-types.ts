import type { TaskActor, TaskStage } from "./task-machine";

export type TaskStepStatus = "pending" | "active" | "done" | "skipped";

export type TaskStep = {
  id: number;
  runId: number;
  position: number;
  title: string;
  status: TaskStepStatus;
  result: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskEventKind =
  | "transition"
  | "step"
  | "pause"
  | "resume"
  | "rejected";

export type TaskEvent = {
  id: number;
  runId: number;
  kind: TaskEventKind;
  origin: TaskActor;
  fromStage: TaskStage | null;
  toStage: TaskStage | null;
  reason: string | null;
  conversationId: string | null;
  createdAt: string;
};

export type TaskRun = {
  id: number;
  profileId: number;
  title: string;
  goal: string | null;
  stage: TaskStage;
  paused: boolean;
  expectedActor: TaskActor;
  expectedAction: string;
  blockedFrom: TaskStage | null;
  blockedReason: string | null;
  currentStepId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskProposal = {
  id: number;
  profileId: number;
  title: string;
  goal: string | null;
  conversationId: string | null;
  createdAt: string;
};

export type TaskSnapshot = {
  run: TaskRun;
  steps: TaskStep[];
  events: TaskEvent[];
};

/** Предложение задачи от агента: ждёт подтверждения человеком. */
export type TaskProposalInput = {
  title: string;
  goal: string | null;
};

export type TaskStateUpdate = {
  transition: TaskStage | null;
  completedSteps: number[];
  newSteps: string[];
  expectedActor: TaskActor | null;
  expectedAction: string | null;
  block: string | null;
};

export type TaskUpdateOutcome = {
  applied: boolean;
  rejectedReason: string | null;
  stage: TaskStage;
};

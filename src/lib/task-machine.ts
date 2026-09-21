export type TaskStage =
  | "planning"
  | "execution"
  | "validation"
  | "done"
  | "blocked"
  | "cancelled";

export type TaskActor = "agent" | "user";

export const TASK_STAGES: readonly TaskStage[] = [
  "planning",
  "execution",
  "validation",
  "done",
  "blocked",
  "cancelled",
];

/** Основная линия прогресса; blocked и cancelled лежат вне неё. */
export const TASK_PIPELINE: readonly TaskStage[] = [
  "planning",
  "execution",
  "validation",
  "done",
];

const TRANSITIONS: Record<TaskStage, readonly TaskStage[]> = {
  planning: ["execution", "cancelled"],
  execution: ["validation", "blocked", "cancelled"],
  validation: ["done", "execution", "blocked", "cancelled"],
  blocked: ["execution", "validation", "cancelled"],
  done: [],
  cancelled: [],
};

export const TASK_STAGE_LABELS: Record<TaskStage, string> = {
  planning: "планирование",
  execution: "выполнение",
  validation: "проверка",
  done: "готово",
  blocked: "заблокировано",
  cancelled: "отменено",
};

export type TaskExpectation = {
  actor: TaskActor;
  action: string;
};

const DEFAULT_EXPECTATIONS: Record<TaskStage, TaskExpectation> = {
  planning: { actor: "agent", action: "составить план шагов и согласовать его" },
  execution: { actor: "agent", action: "выполнить текущий шаг" },
  validation: { actor: "user", action: "проверить результат и подтвердить" },
  done: { actor: "user", action: "задача завершена, действий не требуется" },
  blocked: { actor: "user", action: "снять блокировку" },
  cancelled: { actor: "user", action: "задача отменена, действий не требуется" },
};

export function isTerminalStage(stage: TaskStage): boolean {
  return TRANSITIONS[stage].length === 0;
}

export function allowedTransitions(stage: TaskStage): readonly TaskStage[] {
  return TRANSITIONS[stage];
}

export function defaultExpectation(stage: TaskStage): TaskExpectation {
  return DEFAULT_EXPECTATIONS[stage];
}

export type TransitionCheck =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Состояние задачи, от которого зависят предусловия перехода. Передаётся
 * аргументом, чтобы автомат оставался чистым.
 */
export type TransitionContext = {
  planApproved: boolean;
  totalSteps: number;
  openSteps: number;
};

/**
 * Предусловия жизненного цикла: смежности недостаточно. Реализация невозможна
 * без утверждённого плана, проверка — с незакрытыми шагами, финал принимает
 * только человек.
 */
function checkPrecondition(
  from: TaskStage,
  to: TaskStage,
  origin: TaskActor,
  context: TransitionContext | undefined,
): string | null {
  if (!context) return null;

  if (from === "planning" && to === "execution") {
    if (context.totalSteps === 0) {
      return "Плана нет: сначала составьте шаги задачи.";
    }
    if (!context.planApproved) {
      return "План не утверждён: реализация начинается после утверждения.";
    }
  }

  if (from === "execution" && to === "validation" && context.openSteps > 0) {
    return `Осталось незакрытых шагов: ${context.openSteps}. Проверка начинается после их завершения.`;
  }

  if (to === "done" && origin !== "user") {
    return "Финал принимает человек: агент не закрывает задачу сам.";
  }

  return null;
}

/**
 * Проверяет переход автомата. Пауза сильнее таблицы переходов: пока задача
 * приостановлена, её может сдвинуть только человек.
 */
export function checkTransition(input: {
  from: TaskStage;
  to: TaskStage;
  paused: boolean;
  origin: TaskActor;
  blockedFrom?: TaskStage | null;
  context?: TransitionContext;
}): TransitionCheck {
  if (input.from === input.to) {
    return { allowed: false, reason: `Задача уже на этапе ${input.from}.` };
  }
  if (isTerminalStage(input.from)) {
    return { allowed: false, reason: `Этап ${input.from} терминальный.` };
  }
  if (input.paused && input.origin === "agent") {
    return {
      allowed: false,
      reason: "Задача на паузе: переходы агента не применяются.",
    };
  }
  if (!TRANSITIONS[input.from].includes(input.to)) {
    return {
      allowed: false,
      reason: `Переход ${input.from} → ${input.to} не разрешён.`,
    };
  }
  const precondition = checkPrecondition(input.from, input.to, input.origin, input.context);
  if (precondition) return { allowed: false, reason: precondition };

  if (
    input.from === "blocked" &&
    input.to !== "cancelled" &&
    input.blockedFrom &&
    input.to !== input.blockedFrom
  ) {
    return {
      allowed: false,
      reason: `Из блокировки возвращаются в ${input.blockedFrom}.`,
    };
  }

  return { allowed: true };
}

export function isTaskStage(value: unknown): value is TaskStage {
  return typeof value === "string" && TASK_STAGES.includes(value as TaskStage);
}

export interface LessonStepAccessInput {
  id: string;
  completedAt: unknown | null;
}

/**
 * Completed steps stay available. Of the unfinished steps only the first one
 * is open, so reading and completion share the same sequential contract.
 */
export function withLessonStepAccess<T extends LessonStepAccessInput>(
  steps: readonly T[],
): Array<T & { unlocked: boolean }> {
  let previousStepsCompleted = true;

  return steps.map((step) => {
    const completed = step.completedAt !== null;
    const unlocked = completed || previousStepsCompleted;
    previousStepsCompleted = previousStepsCompleted && completed;
    return { ...step, unlocked };
  });
}

/** A locked or unknown URL target resolves to the first available unfinished step. */
export function resolveAccessibleLessonStep<
  T extends LessonStepAccessInput & { unlocked: boolean },
>(steps: readonly T[], requestedStepId?: string): T | null {
  const requested = requestedStepId ? steps.find((step) => step.id === requestedStepId) : undefined;
  if (requested?.unlocked) return requested;

  return (
    steps.find((step) => step.unlocked && step.completedAt === null) ??
    steps.find((step) => step.unlocked) ??
    null
  );
}

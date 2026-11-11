import type { Chore, Task } from './types';

export interface Progress {
  done: number;
  total: number;
  ratio: number;
}

export function progress(task: Pick<Task, 'steps'>): Progress {
  const total = task.steps.length;
  let done = 0;
  for (const s of task.steps) if (s.done) done++;
  return { done, total, ratio: total === 0 ? 0 : done / total };
}

const CHORES: readonly Chore[] = ['sweep', 'water', 'window'];

/** 第 i 个步骤（从 0 起）对应的家务：i 对 3 取余。 */
export function choreFor(stepIndex: number): Chore {
  return CHORES[((stepIndex % 3) + 3) % 3]!;
}

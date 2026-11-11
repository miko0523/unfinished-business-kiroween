// State_Evaluator：只看 Task 数据，不读时间。tasks 中只有未确认的 Task，所以这里只会得到 gray / white / green。
import { progress } from './progress';
import type { GhostState, Task } from './types';

/** Clarified：完成条件去首尾空白后非空，且至少有 1 个步骤。 */
export function isClarified(task: Pick<Task, 'criteria' | 'steps'>): boolean {
  return task.criteria.trim().length > 0 && task.steps.length >= 1;
}

export function evaluate(task: Pick<Task, 'criteria' | 'steps'>): GhostState {
  if (!isClarified(task)) return 'gray';
  return progress(task).done === 0 ? 'white' : 'green';
}

/** 已 Clarified 且全部步骤已完成、尚未确认（派生标志，不是第五状态）。 */
export function isPendingConfirmation(task: Pick<Task, 'criteria' | 'steps'>): boolean {
  if (!isClarified(task)) return false;
  const { done, total } = progress(task);
  return total > 0 && done === total;
}

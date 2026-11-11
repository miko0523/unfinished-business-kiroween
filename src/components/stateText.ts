import { evaluate, isPendingConfirmation } from '../domain/evaluate';
import type { GhostState, Task } from '../domain/types';
import { forLanguage, type Translate } from '../i18n/t';

/** 状态图标：颜色之外的第二种表达（需求 3.8、8.9）。 */
export const STATE_ICON: Record<GhostState, string> = { gray: '◌', white: '○', green: '●', gold: '★' };

/** 玩家可见的状态名；等待确认时是“Ready to confirm”。 */
export function stateLabel(task: Pick<Task, 'criteria' | 'steps'>, t: Translate = forLanguage('en')): string {
  return isPendingConfirmation(task) ? t('state.pending') : t(`state.${evaluate(task)}`);
}

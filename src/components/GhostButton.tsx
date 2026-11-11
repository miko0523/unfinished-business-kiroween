import { evaluate, isPendingConfirmation } from '../domain/evaluate';
import { progress } from '../domain/progress';
import type { Task } from '../domain/types';
import { ghostPaint } from '../house/paint';
import type { Pose } from '../house/motion';
import { useCopy } from './useCopy';
import { useSampleText } from './useSampleText';
import { forLanguage, type Translate } from '../i18n/t';
import { BurstFx, ChoreFx } from './GhostFx';
import { GhostSprite } from './GhostSprite';
import { stateLabel, STATE_ICON } from './stateText';
import type { GhostPlay } from './useGhostPlays';
import { useReducedMotion } from './useReducedMotion';
import type { Facing } from '../animation/walk';

export interface GhostButtonProps {
  task: Task;
  selected: boolean;
  entering: boolean;
  play?: GhostPlay;
  pose?: Pose;
  /** 水平漫游时的朝向（-1 左、1 右、0 回正）。 */
  walk?: Facing;
  onSelect(taskId: string, trigger: HTMLElement): void;
  onEntered(taskId: string): void;
}

/** 玩家可见称呼按位置生成（例如“二楼左边的小幽灵”）；绝不含 id 或内部编号。 */
export function ghostLocation(task: Pick<Task, 'slot'>, t: Translate = forLanguage('en')): string {
  return t('ghost.location', {
    floor: task.slot.floor,
    side: t(task.slot.slot === 0 ? 'ghost.side.left' : 'ghost.side.right'),
  });
}

export function GhostButton({ task, selected, entering, play, pose = 'rest', walk = 0, onSelect, onEntered }: GhostButtonProps) {
  const t = useCopy();
  const sampleText = useSampleText();
  const state = evaluate(task);
  const pending = isPendingConfirmation(task);
  const { done, total, ratio } = progress(task);
  const stateText = stateLabel(task, t);
  const needsDone = total > 0 && done === total && task.criteria.trim().length === 0;
  const name = `${task.ghostKind === 'lantern' ? `${t('collection.resident')}, ` : ''}${t('ghost.name', { location: ghostLocation(task, t), title: sampleText(task.title), state: stateText })}, ${t('ghost.progress', { done, total })}`;
  const side = task.slot.slot === 0 ? 'left' : 'right';
  // 减少动态：没有道具、手脚动作、星星和漫游，只剩颜色与静态表情。
  const reduced = useReducedMotion();

  return (
    <button
      type="button"
      class="ghost-button"
      aria-label={name}
      aria-pressed={selected}
      data-ghost
      data-state={state}
      data-pending={pending ? 'true' : 'false'}
      data-floor={task.slot.floor}
      data-slot={task.slot.slot}
      data-chore={play?.kind && play.kind !== 'erase' && play.kind !== 'clarify' ? play.kind : undefined}
      data-chore-total={play?.choreTotal ?? 0}
      data-anim={play?.kind ?? 'none'}
      data-pose={pose}
      data-walk={reduced ? 0 : walk}
      onClick={(e) => onSelect(task.id, e.currentTarget)}
    >
      <span
        class={`ghost-motion ghost-from-${side}${entering ? ' ghost-enter' : ''}`}
        onAnimationEnd={() => entering && onEntered(task.id)}
      >
        <span class="ghost-play" key={play?.n ?? 0} data-anim={play?.kind ?? 'none'}>
          <GhostSprite
            ghostKind={task.ghostKind}
            paint={ghostPaint(state, ratio, pending)}
            expression={play?.kind ? play.expression : pose === 'greet' || pending ? 'happy' : needsDone ? 'puzzled' : 'shy'}
            prop={reduced ? 'none' : play?.kind ? play.prop : pose === 'tool' ? 'broom' : 'none'}
            rightHand={pose === 'greet' && !reduced ? -40 : 0}
            walk={reduced ? 0 : walk}
            scene={reduced ? null : <ChoreFx kind={play?.kind ?? null} />}
          >
            {reduced ? null : <BurstFx burst={play?.burst ?? null} />}
          </GhostSprite>
        </span>
      </span>
      <span class="ghost-tag" aria-hidden="true">
        <span class="ghost-tag-icon">{STATE_ICON[state]}</span> {done}/{total}
      </span>
    </button>
  );
}

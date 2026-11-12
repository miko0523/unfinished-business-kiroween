// 领域事件 → 音效（R14.4）。纯函数：只看事件本身，被拒绝的操作没有事件，也就没有音效。
import { GOLD_MS, WAVE_MS, planCelebration } from '../animation/plan';
import type { AnimEvent, Chore, GhostKind } from '../domain/types';
import { LOBBY } from '../house/data/lobby';

export const CUE_NAMES = ['move-in', 'sweep', 'water', 'wipe', 'stamp', 'lamp', 'lantern'] as const;
export type CueName = (typeof CUE_NAMES)[number];

export interface Cue {
  name: CueName;
  /** 相对这批事件的延迟（毫秒）。 */
  delayMs: number;
  /** 送别的两声带上纪念条目，跳过动画时据此补上还没响的。 */
  entryId?: string;
}

/** 家务与音效一一对应：扫地、浇水、擦窗。 */
export const CHORE_CUE: Readonly<Record<Chore, CueName>> = { sweep: 'sweep', water: 'water', 'window': 'wipe' };

/** 提灯朋友的风铃跟在“噗”之后。 */
export const LANTERN_AFTER_MS = 500;
/** 减少动态：静止盖章页立刻出现，灯亮的“叮”稍后一点。 */
export const STILL_LAMP_AFTER_MS = 450;

/** 送别两声相对确认的时刻：对准盖章阶段的开始与暖灯点亮；减少动态下对准静止盖章页。 */
export function farewellTimes(reduced: boolean): { stamp: number; lamp: number } {
  if (reduced) return { stamp: 0, lamp: STILL_LAMP_AFTER_MS };
  const plan = planCelebration({ archiveDerived: LOBBY.archiveBook.status === 'derived' });
  return { stamp: GOLD_MS + WAVE_MS, lamp: plan.lampAtMs };
}

/**
 * 一批事件对应的音效。kindOf 查这只幽灵此刻的身份（入住事件只带 taskId）。
 * 取消勾选、状态变化、长楼、搬走、暖灯都没有音效。
 */
export function cuesFor(events: readonly AnimEvent[], kindOf: (taskId: string) => GhostKind | undefined, reduced = false): Cue[] {
  const out: Cue[] = [];
  for (const e of events) {
    switch (e.type) {
      case 'GhostMovedIn':
        out.push({ name: 'move-in', delayMs: 0 });
        if (kindOf(e.taskId) === 'lantern') out.push({ name: 'lantern', delayMs: LANTERN_AFTER_MS });
        break;
      case 'StepChecked':
        out.push({ name: CHORE_CUE[e.chore], delayMs: 0 });
        break;
      case 'Confirmed': {
        const at = farewellTimes(reduced);
        out.push({ name: 'stamp', delayMs: at.stamp, entryId: e.entryId }, { name: 'lamp', delayMs: at.lamp, entryId: e.entryId });
        break;
      }
      default:
        break;
    }
  }
  return out;
}

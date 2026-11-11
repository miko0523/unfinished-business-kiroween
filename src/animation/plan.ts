// 庆祝序列的时间表：变金 → 挥手 → 盖章 → 飞进纪念册。纯数据。
// 暖灯在飞行的最后 0.5 秒点亮，与飞行重叠，不另占时长。
export type StepKind = 'gold' | 'wave' | 'stamp' | 'fly';

export interface PlanStep {
  kind: StepKind;
  ms: number;
}

export const GOLD_MS = 1000;
export const WAVE_MS = 900;
export const STAMP_MS = 900;
export const FLY_MS = 1800;
export const LAMP_LEAD_MS = 500;
/** 整段庆祝序列的上限（需求 5.7）。 */
export const CELEBRATION_LIMIT_MS = 5000;

export interface CelebrationPlan {
  steps: PlanStep[];
  totalMs: number;
  /** 暖灯点亮的时刻（从序列开始算）。 */
  lampAtMs: number;
}

/**
 * archiveDerived 为 false（纪念册目标点没有派生出来）时不计划飞行：
 * 不伪造终点，序列在盖章后结束，由界面直接显示稳态与文字。
 */
export function planCelebration(opts: { archiveDerived: boolean }): CelebrationPlan {
  const steps: PlanStep[] = [
    { kind: 'gold', ms: GOLD_MS },
    { kind: 'wave', ms: WAVE_MS },
    { kind: 'stamp', ms: STAMP_MS },
  ];
  if (opts.archiveDerived) steps.push({ kind: 'fly', ms: FLY_MS });
  const totalMs = steps.reduce((n, s) => n + s.ms, 0);
  return { steps, totalMs, lampAtMs: opts.archiveDerived ? totalMs - LAMP_LEAD_MS : totalMs };
}

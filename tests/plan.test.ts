import { describe, expect, it } from 'vitest';
import { CELEBRATION_LIMIT_MS, planCelebration } from '../src/animation/plan';

describe('庆祝序列时间表', () => {
  it('顺序为变金、挥手、盖章、飞进纪念册，合计 4.6 秒，不超过 5 秒', () => {
    const p = planCelebration({ archiveDerived: true });
    expect(p.steps.map((s) => s.kind)).toEqual(['gold', 'wave', 'stamp', 'fly']);
    expect(p.steps.map((s) => s.ms)).toEqual([1000, 900, 900, 1800]);
    expect(p.totalMs).toBe(4600);
    expect(p.totalMs).toBeLessThanOrEqual(CELEBRATION_LIMIT_MS);
  });

  it('暖灯在飞行的最后 0.5 秒点亮，与飞行重叠，不另占时长', () => {
    const p = planCelebration({ archiveDerived: true });
    expect(p.lampAtMs).toBe(p.totalMs - 500);
    expect(p.lampAtMs).toBeGreaterThan(p.steps[0]!.ms + p.steps[1]!.ms + p.steps[2]!.ms);
  });

  it('纪念册目标点没有派生出来时不计划飞行，不伪造终点', () => {
    const p = planCelebration({ archiveDerived: false });
    expect(p.steps.map((s) => s.kind)).toEqual(['gold', 'wave', 'stamp']);
    expect(p.steps.some((s) => s.kind === 'fly')).toBe(false);
  });
});

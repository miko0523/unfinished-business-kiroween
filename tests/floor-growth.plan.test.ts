import { describe, expect, it } from 'vitest';
import { FLOOR_GROWTH_MS, planFloorGrowth } from '../src/animation/floorGrowth';
import { floorModuleForFloor } from '../src/house/assets';
import { MODULES } from '../src/house/data/modules';
import { layoutHouse } from '../src/house/layout';

describe('planFloorGrowth：只取决于两个 grownFloors 的布局差值', () => {
  for (const [from, to] of [[2, 3], [3, 4], [4, 5], [5, 6]] as const) {
    it(`${from} → ${to}：只新增这一层；屋顶从旧位置回到新位置；星星少且在时长内`, () => {
      const p = planFloorGrowth(from, to);
      expect(p.newModules).toEqual([floorModuleForFloor(to)]);
      // 屋顶起点 = 旧布局里屋顶的位置（相对新屋顶），以屋顶自身高度的百分比表达
      const lift = layoutHouse(from).roofY - layoutHouse(to).roofY;
      expect(lift).toBeGreaterThan(0);
      expect(p.roofFromYPct).toBeCloseTo((lift / MODULES.roof.height) * 100, 9);
      expect(p.sparkles.length).toBeGreaterThanOrEqual(3);
      expect(p.sparkles.length).toBeLessThanOrEqual(5);
      for (const s of p.sparkles) {
        expect(s.delayMs + s.durationMs).toBeLessThanOrEqual(FLOOR_GROWTH_MS);
        expect(s.leftPct).toBeGreaterThan(0);
        expect(s.leftPct).toBeLessThan(100);
        expect(s.topPct).toBeGreaterThanOrEqual(0);
        // 在屋顶附近：落在屋顶盒子内
        expect(s.topPct).toBeLessThanOrEqual((MODULES.roof.height / layoutHouse(to).stageHeight) * 100);
      }
      expect(planFloorGrowth(from, to)).toEqual(p); // 确定性
    });
  }

  it('总时长不超过 1 秒', () => {
    expect(FLOOR_GROWTH_MS).toBeLessThanOrEqual(1000);
  });
});

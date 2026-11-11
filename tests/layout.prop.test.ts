import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { layoutHouse } from '../src/house/layout';
import { MODULES } from '../src/house/data/modules';

const grown = fc.integer({ min: 2, max: 6 });

describe('Feature: unfinished-business, Property 22: 静态堆叠连续且屋顶随最顶层', () => {
  it('模块顺序、接缝重合、错位约束、增长时只新增一个模块并移动屋顶、结果只取决于 grownFloors', () => {
    fc.assert(
      fc.property(grown, (n) => {
        const layout = layoutHouse(n);
        const ms = layout.modules;
        expect(ms.map((m) => m.id)).toEqual(['lobby', ...Array.from({ length: n - 1 }, (_, i) => `floor-0${i + 1}`), 'roof']);
        for (let i = 1; i < ms.length; i++) {
          const below = ms[i - 1]!;
          const above = ms[i]!;
          expect(above.y + MODULES[above.id].bottomJoin).toBe(below.y + MODULES[below.id].topJoin);
          expect(Math.abs(above.dx - below.dx)).toBeLessThanOrEqual(8);
        }
        for (const m of ms) expect(Math.abs(m.dx)).toBeLessThanOrEqual(4);
        expect(ms.at(-1)!.dx).toBe(ms.at(-2)!.dx);
        if (n < 6) {
          const taller = layoutHouse(n + 1);
          const kept = taller.modules.filter((m) => m.id !== 'roof').slice(0, -1);
          expect(kept).toEqual(ms.filter((m) => m.id !== 'roof'));
          expect(taller.modules).toHaveLength(ms.length + 1);
          expect(taller.roofY).not.toBe(layout.roofY);
        }
        expect(layoutHouse(n)).toEqual(layout);
      }),
      { numRuns: 100 },
    );
  });
});

describe('layoutHouse（属性 22 的逐项示例）', () => {
  it('模块依次为 lobby、floor-01…floor-(n−1)、roof', () => {
    fc.assert(
      fc.property(grown, (n) => {
        const ids = layoutHouse(n).modules.map((m) => m.id);
        const floors = Array.from({ length: n - 1 }, (_, i) => `floor-0${i + 1}`);
        expect(ids).toEqual(['lobby', ...floors, 'roof']);
      }),
    );
  });

  it('相邻模块 join 线 y 重合：上方 y+bottomJoin == 下方 y+topJoin', () => {
    fc.assert(
      fc.property(grown, (n) => {
        const ms = layoutHouse(n).modules;
        for (let i = 1; i < ms.length; i++) {
          const below = ms[i - 1]!;
          const above = ms[i]!;
          expect(above.y + MODULES[above.id].bottomJoin).toBe(below.y + MODULES[below.id].topJoin);
        }
      }),
    );
  });

  it('|dx| ≤ 4，相邻 |dx 差| ≤ 8，roof 与最顶楼层 dx 相同', () => {
    fc.assert(
      fc.property(grown, (n) => {
        const ms = layoutHouse(n).modules;
        for (const m of ms) expect(Math.abs(m.dx)).toBeLessThanOrEqual(4);
        for (let i = 1; i < ms.length; i++) expect(Math.abs(ms[i]!.dx - ms[i - 1]!.dx)).toBeLessThanOrEqual(8);
        expect(ms[ms.length - 1]!.dx).toBe(ms[ms.length - 2]!.dx);
      }),
    );
  });

  it('多长一层：原有模块 y 与 dx 不变，只新增一个模块并移动 roof', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 5 }), (n) => {
        const a = layoutHouse(n);
        const b = layoutHouse(n + 1);
        const aBody = a.modules.slice(0, -1);
        const bBody = b.modules.slice(0, -2);
        expect(bBody).toEqual(aBody);
        expect(b.modules).toHaveLength(a.modules.length + 1);
        expect(b.roofY).toBeLessThan(a.roofY);
      }),
    );
  });

  it('舞台高度与 design 一致：813 / 1092 / 1369 / 1647 / 1930', () => {
    expect([2, 3, 4, 5, 6].map((n) => layoutHouse(n).stageHeight)).toEqual([813, 1092, 1369, 1647, 1930]);
  });

  it('design 表中的 y 值', () => {
    const ys = Object.fromEntries(layoutHouse(6).modules.map((m) => [m.id, m.y]));
    expect(ys).toMatchObject({
      lobby: 0,
      'floor-01': -278,
      'floor-02': -557,
      'floor-03': -834,
      'floor-04': -1112,
      'floor-05': -1394,
      roof: -1648,
    });
    expect([2, 3, 4, 5].map((n) => layoutHouse(n).roofY)).toEqual([-531, -810, -1087, -1365]);
  });

  it('结果只取决于 grownFloors，与时间和随机数无关', () => {
    const now = vi.spyOn(Date, 'now');
    const rnd = vi.spyOn(Math, 'random');
    try {
      fc.assert(
        fc.property(grown, (n) => {
          expect(layoutHouse(n)).toEqual(layoutHouse(n));
        }),
      );
      expect(now).not.toHaveBeenCalled();
      expect(rnd).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
      rnd.mockRestore();
    }
  });

  it('范围外的 grownFloors 抛出 RangeError', () => {
    for (const n of [1, 7, 0, 3.5, Number.NaN]) expect(() => layoutHouse(n)).toThrow(RangeError);
  });
});

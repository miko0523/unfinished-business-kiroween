import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeViewLayout, focusScrollDelta, HOUSE_MAX_W, PAN_MIN_W, WIDE_MIN } from '../src/house/viewport';
import { stageSpot, STAGE_LIFT } from '../src/house/stageSpot';
import { STAGE_WIDTH } from '../src/house/stage';

const viewArb = fc.record({
  vw: fc.integer({ min: 160, max: 3840 }),
  vh: fc.integer({ min: 300, max: 2400 }),
  grownFloors: fc.integer({ min: 2, max: 6 }),
  camera: fc.constantFrom('focus' as const, 'panorama' as const),
});

describe('Feature: unfinished-business, Property 25: 响应式布局不溢出', () => {
  it('旧宅图宽度不超过 801，舞台不超过 809 也不超出视口；选中与否不影响结果', () => {
    fc.assert(
      fc.property(viewArb, (i) => {
        const v = computeViewLayout(i);
        expect(v.houseW).toBeLessThanOrEqual(HOUSE_MAX_W + 1e-9);
        expect(v.stageW).toBeLessThanOrEqual(STAGE_WIDTH);
        expect(v.stageW).toBeLessThanOrEqual(Math.max(0, i.vw - 16));
        expect(computeViewLayout(i)).toEqual(v); // 纯函数：只取决于视口与镜头
      }),
      { numRuns: 200 },
    );
  });

  it('聚焦时旧宅宽度恒为 min(809, 视口宽 − 16)（图宽 ×801/809），与楼层数、视口高度无关', () => {
    fc.assert(
      fc.property(viewArb, (i) => {
        const v = computeViewLayout({ ...i, camera: 'focus' });
        expect(v.stageW).toBe(Math.min(STAGE_WIDTH, i.vw - 16));
        expect(v.widthPx).toBeNull();
        expect(v.houseW).toBeCloseTo((v.stageW * HOUSE_MAX_W) / STAGE_WIDTH, 9);
        expect(v.panorama).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it('全景只在窄屏起作用：缩小到一屏，但不小于 160，也不大于聚焦时的宽度', () => {
    fc.assert(
      fc.property(viewArb, (i) => {
        const v = computeViewLayout(i);
        const wide = i.vw >= WIDE_MIN;
        expect(v.wide).toBe(wide);
        expect(v.panorama).toBe(!wide && i.camera === 'panorama');
        if (v.panorama) {
          expect(v.widthPx).toBe(v.panW);
          expect(v.panW).toBeLessThanOrEqual(v.stageW);
          expect(v.panW).toBeGreaterThanOrEqual(Math.min(PAN_MIN_W, v.stageW));
        } else expect(v.widthPx).toBeNull();
      }),
      { numRuns: 200 },
    );
  });

  it('全景能放进一屏时，整栋的高度不超过可用高度（宽度没被 160 的下限顶住时）', () => {
    for (const grownFloors of [2, 3, 4, 5, 6]) {
      const v = computeViewLayout({ vw: 390, vh: 800, grownFloors, camera: 'panorama' });
      if (v.panW > PAN_MIN_W && v.panW < v.stageW) expect(v.panW).toBeLessThan(v.stageW);
    }
    const six = computeViewLayout({ vw: 390, vh: 700, grownFloors: 6, camera: 'panorama' });
    expect(six.panW).toBeLessThan(computeViewLayout({ vw: 390, vh: 700, grownFloors: 6, camera: 'focus' }).stageW);
  });
});

describe('聚焦楼层的滚动量', () => {
  it('整层已经在视口里就不动，否则滚到视口中部', () => {
    expect(focusScrollDelta(100, 300, 800)).toBe(0);
    expect(focusScrollDelta(900, 1100, 800)).toBe(900 - 300);
    expect(focusScrollDelta(-400, -200, 800)).toBe(-400 - 300);
    expect(focusScrollDelta(600, 850, 800)).not.toBe(0);
  });
});

describe('抽屉上沿的小舞台', () => {
  const ghost = { width: 138, height: 177 };
  it('站在抽屉正中，盒子底边在抽屉上沿之上一点点', () => {
    const s = stageSpot({ left: 260, width: 760, top: 400 }, ghost, 1280);
    expect(s.cx).toBe(640);
    expect(s.bottom).toBe(400 - STAGE_LIFT);
    expect(s.fits).toBe(true);
  });

  it('窄屏贴边的抽屉：Ghost 整只留在视口内', () => {
    const s = stageSpot({ left: 8, width: 304, top: 380 }, { width: 53, height: 68 }, 320);
    expect(s.cx).toBe(160);
    expect(s.fits).toBe(true);
    const edge = stageSpot({ left: -50, width: 60, top: 380 }, { width: 100, height: 120 }, 320);
    expect(edge.cx).toBeGreaterThanOrEqual(50);
  });

  it('抽屉太高、上方放不下可见部分时不上舞台（改用滚动露出的兜底）', () => {
    expect(stageSpot({ left: 260, width: 760, top: 120 }, ghost, 1280).fits).toBe(false);
    expect(stageSpot({ left: 260, width: 760, top: 300 }, ghost, 1280).fits).toBe(true);
  });

  it('属性：能放下时，Ghost 的可见部分整只在视口内、在抽屉之上', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 900 }), fc.integer({ min: 100, max: 760 }), fc.integer({ min: 40, max: 180 }), (top, dw, gh) => {
        const g = { width: Math.round((gh * 140) / 180), height: gh };
        const s = stageSpot({ left: (1280 - dw) / 2, width: dw, top }, g, 1280);
        if (!s.fits) return;
        expect(s.bottom).toBeLessThan(top);
        expect(s.bottom - g.height * 0.75).toBeGreaterThanOrEqual(0);
        expect(s.cx - g.width / 2).toBeGreaterThanOrEqual(0);
        expect(s.cx + g.width / 2).toBeLessThanOrEqual(1280);
      }),
      { numRuns: 200 },
    );
  });
});

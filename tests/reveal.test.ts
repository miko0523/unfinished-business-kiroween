import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { scrollNeeded } from '../src/components/revealAboveDrawer';

describe('抽屉不遮住被选中的 Ghost：最小滚动量', () => {
  it('已经完整露在抽屉上方时不滚动', () => {
    expect(scrollNeeded(100, 280, 600)).toBe(0);
  });

  it('被抽屉遮住时向下滚恰好够用，并让 Ghost 与小标签落在抽屉上沿之上', () => {
    const delta = scrollNeeded(500, 680, 600);
    expect(delta).toBeGreaterThan(0);
    expect(680 - delta + 26).toBeLessThanOrEqual(600 - 8);
  });

  it('滚动不会把 Ghost 的上沿推出视口顶端', () => {
    fc.assert(
      fc.property(fc.integer({ min: -200, max: 2000 }), fc.integer({ min: 40, max: 220 }), fc.integer({ min: 200, max: 900 }), (top, h, drawerTop) => {
        const delta = scrollNeeded(top, top + h, drawerTop);
        if (delta > 0) expect(top - delta).toBeGreaterThanOrEqual(8 - 1e-9);
        if (delta < 0) expect(top - delta).toBeCloseTo(8, 6);
      }),
    );
  });

  it('Ghost 在视口上方时向上滚回来', () => {
    expect(scrollNeeded(-120, 60, 600)).toBeLessThan(0);
  });
});

import { describe, expect, it } from 'vitest';
import { BODY_HALF, BODY_MID, chooseSide, GAP_PX, GHOST_RISE, placeAbove, placeCard, READABLE_ROOM_PX, type PlacementInput, type Rect } from '../src/animation/stampPlacement';
import { FLOOR_SPACES } from '../src/house/data/space';
import { STAGE_WIDTH } from '../src/house/stage';

const interiorFor = (k: number): Rect => {
  const n = FLOOR_SPACES['floor-01'].navigable;
  return [(4 + n[0]) * k, (4 + n[1]) * k, (4 + n[2]) * k, (4 + n[3]) * k];
};
const input = (k: number, anchorX: number, anchorY: number): PlacementInput => ({
  anchorX: anchorX * k, anchorY: anchorY * k, k, interior: interiorFor(k), naturalWidth: 160, minWidth: 80,
});

describe('盖章卡摆放', () => {
  for (const vw of [320, 400, 800, 1280]) {
    const k = Math.min(801, vw - 16) / STAGE_WIDTH;
    it(`宽度 ${vw}：整层任意位置，卡片都在墙面内、不压幽灵的身体与手`, () => {
      const interior = interiorFor(k);
      for (let ax = 120; ax <= 700; ax += 30) {
        for (let ay = 160; ay <= 260; ay += 20) {
          const i = input(k, ax, ay);
          const { side, width } = chooseSide(i);
          const height = Math.min(110 * k + 40, (interior[3] - interior[1]) * 0.8);
          const { left, top } = placeCard(i, side, width, height);
          expect(left).toBeGreaterThanOrEqual(interior[0] - 0.01);
          expect(left + width).toBeLessThanOrEqual(interior[2] + 0.01);
          expect(top).toBeGreaterThanOrEqual(interior[1]);
          expect(top + height).toBeLessThanOrEqual(interior[3]);
          // 与身体（含手）的水平间隔至少 GAP_PX
          const bodyL = i.anchorX - BODY_HALF * k;
          const bodyR = i.anchorX + BODY_HALF * k;
          expect(left >= bodyR + GAP_PX - 0.01 || left + width <= bodyL - GAP_PX + 0.01).toBe(true);
          expect(width).toBeGreaterThan(60);
        }
      }
    });
  }

  it('空间够时优先放在身体一侧并竖直对齐身体中部', () => {
    const k = 1;
    const i = input(k, 300, 254);
    const { side, width } = chooseSide(i);
    expect(side).toBe('right');
    expect(width).toBe(160);
    const { top } = placeCard(i, side, width, 60);
    expect(top).toBeCloseTo(254 - BODY_MID - 30, 5);
  });

  it('靠右墙时换到左侧', () => {
    const { side } = chooseSide(input(1, 690, 254));
    expect(side).toBe('left');
  });

  describe('身体两侧太窄时改放头顶上方（160 宽 = 320 的 200% 缩放）', () => {
    // 160 宽的视口：舞台宽 136，k≈0.17；视口内可用的横向范围约 140px，幽灵在中间，两侧各只剩五十来像素。
    const k = 136 / STAGE_WIDTH;
    const narrow = (anchorX: number, anchorY: number): PlacementInput => ({
      anchorX: anchorX * k,
      anchorY: anchorY * k,
      k,
      interior: [2, 2, 136 - 2, 1500 * k],
      naturalWidth: 160,
      minWidth: 80,
    });

    it('两侧的余地不到 READABLE_ROOM_PX，所以判为太窄', () => {
      expect(chooseSide(narrow(405, 1200)).room).toBeLessThan(READABLE_ROOM_PX);
      // 够宽的屏不受影响：320 宽时两侧仍放得下，沿用原来的摆法。
      const k320 = 304 / STAGE_WIDTH;
      // 站在抽屉上沿的幽灵用整个舞台宽（被视口夹住）作范围，幽灵在正中。
      const staged: PlacementInput = { ...input(k320, 404.5, 1200), interior: [2, 2, k320 * STAGE_WIDTH - 2, 1500 * k320] };
      expect(chooseSide(staged).room).toBeGreaterThanOrEqual(READABLE_ROOM_PX);
    });

    it('头顶上方整行展开：宽度取满墙面，完整落在范围内，且整个在幽灵头顶之上', () => {
      const i = narrow(405, 1200);
      const a = placeAbove(i, 120);
      expect(a.fits).toBe(true);
      expect(a.width).toBeGreaterThanOrEqual(120);
      expect(a.left).toBeGreaterThanOrEqual(i.interior[0]);
      expect(a.left + a.width).toBeLessThanOrEqual(i.interior[2]);
      expect(a.top).toBeGreaterThanOrEqual(i.interior[1]);
      expect(a.top + 120).toBeLessThanOrEqual(i.anchorY - GHOST_RISE * k);
    });

    it('上方放不下就报告 fits 为假（由调用方退回两侧）；幽灵靠边时卡片仍夹在范围内', () => {
      const lowTop = placeAbove({ ...narrow(405, 40), interior: [2, 2, 134, 1500 * k] }, 120);
      expect(lowTop.fits).toBe(false);
      const edge = placeAbove(narrow(30, 1200), 100);
      expect(edge.left).toBeGreaterThanOrEqual(2);
      const farEdge = placeAbove(narrow(780, 1200), 100);
      expect(farEdge.left + farEdge.width).toBeLessThanOrEqual(134);
    });
  });
});

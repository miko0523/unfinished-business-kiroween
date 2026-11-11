import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodePng } from './helpers/png';
import type { FloorModuleId } from '../src/house/assets';
import { FLOOR_SLOTS } from '../src/house/data/slots';
import { FLOOR_SPACES } from '../src/house/data/space';
import { deriveNavigable, SPACE_PARAMS } from '../src/house/derive/space';
import { envelope, isLegal, REQUIRED_GAP, rectGap } from '../src/house/motion';

const FLOORS: FloorModuleId[] = ['floor-01', 'floor-02', 'floor-03', 'floor-04', 'floor-05'];

describe('楼层空间：navigable 派生自实际 PNG', () => {
  for (const id of FLOORS) {
    it(`${id}：数据文件等于算法在 PNG 上的输出，且证据齐全`, () => {
      const f = FLOOR_SLOTS[id];
      const derived = deriveNavigable(decodePng(`public/assets/dollhouse/1x/${id}.png`), Math.max(f.left.safe[3], f.right.safe[3]));
      expect(FLOOR_SPACES[id].navigable).toEqual(derived.navigable);
      expect(derived.evidence.ceilingHits).toHaveLength(SPACE_PARAMS.ceilingCols.length);
      expect(derived.evidence.leftHits.length).toBeGreaterThan(40);
      expect(derived.evidence.rightHits.length).toBe(derived.evidence.leftHits.length);
    });

    it(`${id}：Home Anchor 与动作位的 envelope 合法，间距满足要求`, () => {
      const space = FLOOR_SPACES[id];
      expect(space.status).toBe('derived');
      const [l, r] = space.homes;
      const a = { x: l[0], y: l[1], pose: 'rest' as const };
      const b = { x: r[0], y: r[1], pose: 'rest' as const };
      expect(isLegal(space, a, b)).toBe(true);
      expect(isLegal(space, b, a)).toBe(true);
      expect(r[0] - l[0]).toBeGreaterThanOrEqual(148);
      for (const spot of space.actionSpots) {
        const pose = spot.kind === 'work' ? 'tool' : 'greet';
        const pa = { x: spot.a[0], y: spot.a[1], pose } as const;
        const pb = { x: spot.b[0], y: spot.b[1], pose } as const;
        expect(isLegal(space, pa, pb)).toBe(true);
        expect(rectGap(envelope(pa), envelope(pb))).toBeGreaterThanOrEqual(REQUIRED_GAP);
        expect(spot.b[0] - spot.a[0]).toBe(spot.kind === 'work' ? 148 : 120);
      }
    });

    it(`${id}：可导航区覆盖整层而不是 Home 附近的小框`, () => {
      const [x0, y0, x1, y1] = FLOOR_SPACES[id].navigable;
      const f = FLOOR_SLOTS[id];
      expect(x1 - x0).toBeGreaterThan(600);
      expect(y1 - y0).toBeGreaterThan(200);
      expect(x1 - x0).toBeGreaterThan(f.right.safe[2] - f.left.safe[0] + 200);
      expect(x1).toBeLessThanOrEqual(f.size[0]);
      expect(y1).toBeLessThanOrEqual(f.size[1]);
    });
  }

  it('显式障碍目前为空（Static_Layer 背景不是障碍），数据文件不含估算类字样', () => {
    for (const id of FLOORS) expect(FLOOR_SPACES[id].obstacles).toEqual([]);
    for (const file of ['src/house/data/space.ts', 'src/house/derive/space.ts']) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/估算|待定|TODO/);
    }
  });
});

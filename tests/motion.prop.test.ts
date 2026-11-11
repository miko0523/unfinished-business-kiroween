import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { FloorModuleId } from '../src/house/assets';
import { FLOOR_SPACES } from '../src/house/data/space';
import {
  GAP_EPSILON, isLegal, nearestToolSpot, pickGoal, planMeet, planMove, pointAlong, rectGap, envelope, REQUIRED_GAP, SAMPLE_STEP,
  type Actor, type Pose,
} from '../src/house/motion';

const FLOORS: FloorModuleId[] = ['floor-01', 'floor-02', 'floor-03', 'floor-04', 'floor-05'];
const floorArb = fc.constantFrom(...FLOORS);

/** 在可导航区内随机生成一对合法静止的 Ghost。 */
function legalPair(id: FloorModuleId, seeds: [number, number, number, number]) {
  const space = FLOOR_SPACES[id];
  const goalA = pickGoal(space, () => seeds[0]);
  const goalB = pickGoal(space, () => seeds[1]);
  void seeds[2];
  void seeds[3];
  const a: Actor = { x: goalA.x, y: goalA.y, pose: 'rest' };
  const b: Actor = { x: goalB.x, y: goalB.y, pose: 'rest' };
  return { space, a, b, ok: isLegal(space, a, b) && isLegal(space, b, a) };
}
const seedsArb = fc.tuple(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }));

describe('Feature: unfinished-business, Property 23: 双住客全房间漫游、连续避让', () => {
  it('planMove 的每个采样点都合法（界内、与对方净距足够、不碰障碍）；被拒绝时返回上一帧', () => {
    fc.assert(
      fc.property(floorArb, seedsArb, fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (id, seeds, gx, gy) => {
        const { space, a, b, ok } = legalPair(id, seeds);
        fc.pre(ok);
        const goal = pickGoal(space, (() => { let i = 0; return () => (i++ === 0 ? gx : gy); })());
        const r = planMove(space, a, b, goal);
        if (r.kind === 'wait') {
          expect(r.keep).toEqual(a);
          return;
        }
        expect(r.next).toEqual({ x: goal.x, y: goal.y, pose: goal.pose });
        for (let t = 0; t <= 1; t += SAMPLE_STEP / Math.max(1, 1000)) {
          const p = pointAlong(r.path, Math.min(1, t));
          const probe: Actor = { x: p[0], y: p[1], pose: 'rest' };
          // 路径上的采样点（步长 SAMPLE_STEP/路径长度的粗网格）全部合法
          expect(isLegal(space, probe, b)).toBe(true);
          expect(rectGap(envelope(probe), envelope(b))).toBeGreaterThanOrEqual(REQUIRED_GAP - GAP_EPSILON);
        }
        expect(isLegal(space, r.next, b)).toBe(true);
      }),
      { numRuns: 150 },
    );
  });

  it('planMeet：双方同步的每个采样点与终点都合法，谁去哪边不固定', () => {
    fc.assert(
      fc.property(floorArb, seedsArb, fc.constantFrom(0, 1), (id, seeds, which) => {
        const { space, a, b, ok } = legalPair(id, seeds);
        fc.pre(ok);
        const spot = space.actionSpots[which]!;
        const r = planMeet(space, a, b, spot);
        if (r.kind === 'wait') return;
        expect(isLegal(space, r.nextA, r.nextB)).toBe(true);
        expect(isLegal(space, r.nextB, r.nextA)).toBe(true);
        const ends = [r.nextA, r.nextB].map((x) => x.x).sort((p, q) => p - q);
        expect(ends).toEqual([spot.a[0], spot.b[0]]);
        for (let t = 0; t <= 1; t += 0.01) {
          const pa = pointAlong(r.pathA, t);
          const pb = pointAlong(r.pathB, t);
          const pose: Pose = t >= 1 ? r.nextA.pose : 'rest';
          const ea: Actor = { x: pa[0], y: pa[1], pose };
          const eb: Actor = { x: pb[0], y: pb[1], pose };
          expect(isLegal(space, ea, eb)).toBe(true);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('两只在各自 Home 时，任一目标点只要合法就能到达或明确等待，且绝不穿过对方', () => {
    for (const id of FLOORS) {
      const space = FLOOR_SPACES[id];
      const [l, r] = space.homes;
      const a: Actor = { x: l[0], y: l[1], pose: 'rest' };
      const b: Actor = { x: r[0], y: r[1], pose: 'rest' };
      // 往对方身后走：必须绕行，或等待
      const res = planMove(space, a, b, { x: r[0] + 60, y: r[1], pose: 'rest' });
      if (res.kind === 'move') {
        for (let t = 0; t <= 1; t += 0.005) {
          const p = pointAlong(res.path, t);
          expect(isLegal(space, { x: p[0], y: p[1], pose: 'rest' }, b)).toBe(true);
        }
      } else expect(res.keep).toEqual(a);
    }
  });

  it('漫游目标覆盖整层：窗边、床边、房间中央与半空都合法可达', () => {
    for (const id of FLOORS) {
      const space = FLOOR_SPACES[id];
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i < 400; i++) {
        const g = pickGoal(space, Math.random);
        expect(isLegal(space, { x: g.x, y: g.y, pose: 'rest' }, null)).toBe(true);
        xs.push(g.x);
        ys.push(g.y);
      }
      const [x0, y0, x1, y1] = space.navigable;
      expect(Math.min(...xs)).toBeLessThan(x0 + 56 + 80);
      expect(Math.max(...xs)).toBeGreaterThan(x1 - 56 - 80);
      expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan((y1 - y0 - 137) * 0.7);
    }
  });

  it('带道具的家务位：夹取后在界内；被占用时返回 wait 或经绕行到达', () => {
    for (const id of FLOORS) {
      const space = FLOOR_SPACES[id];
      const goal = nearestToolSpot(space, [space.navigable[0], space.navigable[1]]);
      expect(isLegal(space, { x: goal.x, y: goal.y, pose: 'tool' }, null)).toBe(true);
    }
  });
});

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createRoamer, type RoamSink } from '../src/animation/schedule';
import type { SlotId } from '../src/domain/types';
import { floorModuleForFloor } from '../src/house/assets';
import { FLOOR_SLOTS, type Point } from '../src/house/data/slots';
import { FLOOR_SPACES } from '../src/house/data/space';
import { envelope, GAP_EPSILON, isLegal, leadingPath, pathLength, planExit, rectGap, REQUIRED_GAP, type Actor, type Pose } from '../src/house/motion';
import { createFakeClock, seeded } from './helpers/clock';

const homeOf = (s: SlotId): Point => {
  const f = FLOOR_SLOTS[floorModuleForFloor(s.floor)];
  return (s.slot === 0 ? f.left : f.right).idle;
};
const spaceOf = (f: SlotId['floor']) => FLOOR_SPACES[floorModuleForFloor(f)];

function setup(seed: number, reduced = false) {
  const clock = createFakeClock();
  const poses = new Map<string, Pose>();
  const fades: { id: string; ms: number; at: number }[] = [];
  const poseLog: { id: string; pose: Pose; at: number }[] = [];
  const sink: RoamSink = {
    play() {},
    place() {},
    pose(id, p) {
      poses.set(id, p);
      poseLog.push({ id, pose: p, at: clock.now() });
    },
    fade: (id, ms) => void fades.push({ id, ms, at: clock.now() }),
  };
  const roamer = createRoamer({ clock, rand: seeded(seed), sink, spaceOf, homeOf, reduced });
  const actor = (id: string): Actor => {
    const p = roamer.positionOf(id)!;
    return { x: p[0], y: p[1], pose: poses.get(id) ?? 'rest' };
  };
  return { clock, roamer, poses, fades, poseLog, actor };
}

const slot = (floor: SlotId['floor'], side: 0 | 1): SlotId => ({ floor, slot: side });

describe('长时假时钟模拟（属性 23 的长时补充：多层、多种子）', () => {
  it('每层两只、4 分钟：每个采样点都合法且不重叠；各自到过不同高度与左右；相遇每层至多每 20 秒一次', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000 }), fc.constantFrom(2, 3, 4, 5, 6) as fc.Arbitrary<SlotId['floor']>, (seed, floor) => {
        const { clock, roamer, poses, poseLog, actor } = setup(seed);
        const space = spaceOf(floor);
        roamer.add('a', slot(floor, 0));
        roamer.add('b', slot(floor, 1));
        const xs: number[] = [];
        const ys: number[] = [];
        for (let t = 0; t < 240_000; t += 50) {
          clock.advance(50);
          const a = actor('a');
          const b = actor('b');
          expect(isLegal(space, a, b) && isLegal(space, b, a)).toBe(true);
          xs.push(a.x, b.x);
          ys.push(a.y, b.y);
        }
        const [x0, y0, x1, y1] = space.navigable;
        // 覆盖整层：不被锁在 Home 附近的小框里
        expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan((x1 - x0) * 0.45);
        expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan((y1 - y0) * 0.2);

        // 相遇开始：两只都从 rest 变成 greet/tool 的时刻
        const starts: number[] = [];
        const state = { a: 'rest' as Pose, b: 'rest' as Pose };
        for (const e of poseLog) {
          const wasMeeting = state.a !== 'rest' && state.b !== 'rest';
          state[e.id as 'a' | 'b'] = e.pose;
          if (!wasMeeting && state.a !== 'rest' && state.b !== 'rest') starts.push(e.at);
        }
        for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(20_000);
        expect(starts.length).toBeLessThanOrEqual(12);
        expect(poses.size).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 },
    );
  });

  it('两层各一对共 4 只：互不干扰，各层各自合法', () => {
    const { clock, roamer, actor } = setup(21);
    roamer.add('a', slot(2, 0));
    roamer.add('b', slot(2, 1));
    roamer.add('c', slot(3, 0));
    roamer.add('d', slot(3, 1));
    for (let t = 0; t < 180_000; t += 50) {
      clock.advance(50);
      expect(isLegal(spaceOf(2), actor('a'), actor('b'))).toBe(true);
      expect(isLegal(spaceOf(2), actor('b'), actor('a'))).toBe(true);
      expect(isLegal(spaceOf(3), actor('c'), actor('d'))).toBe(true);
      expect(isLegal(spaceOf(3), actor('d'), actor('c'))).toBe(true);
    }
  });

  it('选中一只：位置在整个模拟里一动不动；另一只照常活动且始终避开它', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000 }), fc.integer({ min: 1000, max: 60_000 }), (seed, when) => {
        const { clock, roamer, actor } = setup(seed);
        const space = spaceOf(2);
        roamer.add('a', slot(2, 0));
        roamer.add('b', slot(2, 1));
        clock.advance(when);
        roamer.select('a');
        const still = roamer.positionOf('a')!;
        for (let t = 0; t < 90_000; t += 100) {
          clock.advance(100);
          expect(roamer.positionOf('a')).toEqual(still);
          expect(isLegal(space, actor('b'), actor('a'))).toBe(true);
          expect(isLegal(space, actor('a'), actor('b'))).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('页面隐藏：暂停后两只一动不动、不再排队任何计时；回来后继续', () => {
    const { clock, roamer, actor } = setup(5);
    roamer.add('a', slot(2, 0));
    roamer.add('b', slot(2, 1));
    clock.advance(30_000);
    roamer.setPaused(true);
    const a = roamer.positionOf('a');
    const b = roamer.positionOf('b');
    clock.advance(120_000);
    expect(roamer.positionOf('a')).toEqual(a);
    expect(roamer.positionOf('b')).toEqual(b);
    roamer.setPaused(false);
    let moved = false;
    for (let t = 0; t < 60_000 && !moved; t += 100) {
      clock.advance(100);
      moved = Math.abs(actor('a').x - a![0]) + Math.abs(actor('b').x - b![0]) > 5;
    }
    expect(moved).toBe(true);
  });

  it('Reduced Motion：两只固定在各自 Home，姿态不变，也没有任何计时在排队', () => {
    for (const floor of [2, 3, 4, 5, 6] as const) {
      const { clock, roamer, poses } = setup(floor, true);
      roamer.add('a', slot(floor, 0));
      roamer.add('b', slot(floor, 1));
      clock.advance(300_000);
      expect(roamer.positionOf('a')).toEqual(homeOf(slot(floor, 0)));
      expect(roamer.positionOf('b')).toEqual(homeOf(slot(floor, 1)));
      expect(poses.size).toBe(0);
      expect(clock.pending()).toBe(0);
    }
  });

  it('动作位被占用时不重叠：相遇前后，被定住的那一只不被打扰', () => {
    // 定住的一只正好站在中央动作位上：另一只不会穿过它，也不会与它相遇。
    const { clock, roamer, actor } = setup(8);
    const space = spaceOf(2);
    roamer.add('a', slot(2, 0));
    roamer.add('b', slot(2, 1));
    for (let t = 0; t < 40_000; t += 100) clock.advance(100);
    roamer.pin('a');
    const there = roamer.positionOf('a')!;
    for (let t = 0; t < 200_000; t += 50) {
      clock.advance(50);
      expect(roamer.positionOf('a')).toEqual(there);
      expect(isLegal(space, actor('b'), actor('a'))).toBe(true);
      expect(isLegal(space, actor('a'), actor('b'))).toBe(true);
    }
  });
});

describe('搬走：拿起行李、朝外缘走一小段并淡出（约 1.5 秒）', () => {
  it('时间线：很快拿起行李（tool），其后淡出 1 秒，约 1.5 秒后恰好结束一次；路上始终与室友保持距离，室友不被动一下', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { clock, roamer, fades, poseLog, actor } = setup(seed);
      const space = spaceOf(2);
      roamer.add('a', slot(2, 0));
      roamer.add('b', slot(2, 1));
      clock.advance(5000 + seed * 700);
      const t0 = clock.now();
      let done = 0;
      let doneAt = -1;
      roamer.depart('a', () => {
        done++;
        doneAt = clock.now();
      });
      const mate0 = roamer.positionOf('b');
      const mateStopped = roamer.positionOf('b')!;
      for (let t = 0; t < 2500; t += 20) {
        clock.advance(20);
        expect(isLegal(space, actor('a'), actor('b'))).toBe(true);
        expect(isLegal(space, actor('b'), actor('a'))).toBe(true);
        // 搬走演完之前室友一动不动（演完后它才继续漫游）
        if (done === 0) expect(roamer.positionOf('b')).toEqual(mateStopped);
      }
      expect(mate0).toBeTruthy();
      expect(done).toBe(1);
      expect(doneAt - t0).toBeGreaterThanOrEqual(1400);
      expect(doneAt - t0).toBeLessThanOrEqual(2000);
      const lift = poseLog.find((p) => p.id === 'a' && p.pose === 'tool' && p.at >= t0);
      const fade = fades.find((f) => f.id === 'a');
      expect(fade).toBeTruthy();
      expect(fade!.ms).toBe(1000);
      if (lift) expect(lift.at).toBeLessThanOrEqual(fade!.at);
    }
  });

  it('室友紧贴着时先延后：拿不起行李也会照常走完，从不穿过室友', () => {
    // 逼近：让 b 在 a 的紧邻处定住，a 的 tool 包围盒放不下。
    let sawDelayedLift = false;
    for (let seed = 1; seed <= 60 && !sawDelayedLift; seed++) {
      const { clock, roamer, poseLog, actor } = setup(seed);
      const space = spaceOf(2);
      roamer.add('a', slot(2, 0));
      roamer.add('b', slot(2, 1));
      clock.advance(3000);
      // 在一段时间内寻找两只靠得近的瞬间（净距够但 tool 放不下）
      for (let t = 0; t < 300_000; t += 50) {
        clock.advance(50);
        const a = actor('a');
        const b = actor('b');
        const tooClose = isLegal(space, a, b) && !isLegal(space, { ...a, pose: 'tool' }, b);
        if (!tooClose) continue;
        const t0 = clock.now();
        let done = false;
        roamer.depart('a', () => (done = true));
        for (let k = 0; k < 3000; k += 20) {
          clock.advance(20);
          expect(isLegal(space, actor('a'), actor('b'))).toBe(true);
          expect(isLegal(space, actor('b'), actor('a'))).toBe(true);
        }
        expect(done).toBe(true);
        const lift = poseLog.find((p) => p.id === 'a' && p.pose === 'tool' && p.at >= t0);
        if (!lift || lift.at - t0 > 0) sawDelayedLift = true;
        break;
      }
    }
    expect(sawDelayedLift).toBe(true);
  });

  it('Reduced Motion 与页面隐藏：立刻结束，不播放任何东西', () => {
    const r = setup(3, true);
    r.roamer.add('a', slot(2, 0));
    let done = 0;
    r.roamer.depart('a', () => done++);
    expect(done).toBe(1);
    expect(r.fades).toEqual([]);
    expect(r.clock.pending()).toBe(0);

    const p = setup(3);
    p.roamer.add('a', slot(2, 0));
    p.roamer.setPaused(true);
    let doneP = 0;
    p.roamer.depart('a', () => doneP++);
    expect(doneP).toBe(1);
  });

  it('搬走途中切到 Reduced Motion 或页面隐藏：立刻结束一次，且只结束一次', () => {
    for (const how of ['reduce', 'hide'] as const) {
      const { clock, roamer } = setup(4);
      roamer.add('a', slot(2, 0));
      roamer.add('b', slot(2, 1));
      clock.advance(8000);
      let done = 0;
      roamer.depart('a', () => done++);
      clock.advance(300);
      expect(done).toBe(0);
      if (how === 'reduce') roamer.setReduced(true);
      else roamer.setPaused(true);
      expect(done).toBe(1);
      clock.advance(5000);
      expect(done).toBe(1);
    }
  });

  it('搬走时室友家务：等它走完或略过动作，从不重叠', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { clock, roamer, actor } = setup(seed);
      const space = spaceOf(2);
      roamer.add('a', slot(2, 0));
      roamer.add('b', slot(2, 1));
      clock.advance(6000);
      roamer.depart('a', () => {});
      const results: boolean[] = [];
      roamer.chore('b', 1800, (ok) => results.push(ok));
      for (let t = 0; t < 6000; t += 20) {
        clock.advance(20);
        const a = actor('a');
        const b = actor('b');
        expect(isLegal(space, { ...a, pose: 'rest' }, { ...b, pose: 'rest' })).toBe(true);
      }
      expect(results.length).toBe(1);
    }
  });

  it('搬走后移除：这一层只剩室友，之后调度正常，没有残留计时', () => {
    const { clock, roamer } = setup(9);
    roamer.add('a', slot(2, 0));
    roamer.add('b', slot(2, 1));
    clock.advance(4000);
    roamer.depart('a', () => roamer.remove('a'));
    clock.advance(3000);
    expect(roamer.positionOf('a')).toBeNull();
    clock.advance(60_000);
    expect(roamer.positionOf('b')).toBeTruthy();
    roamer.remove('b');
    expect(clock.pending()).toBe(0);
  });
});

describe('净距恰好等于下限时的浮点边界（回归：种子 50595、第 5 层）', () => {
  // 随机属性测试曾在种子 50595、第 5 层、第 239800 毫秒报告“两只净距不足”。
  // 根因不是间距不够：动作位的两端恰好相距 REQUIRED_GAP，两只沿平行路径同步移动，净距在数学上始终等于 8，
  // 但两条插值各带约 1e-14 的舍入误差，逐点比较得到 7.99999999999996。判定必须容许这一点点浮点误差，又不能放过真的不够。
  it('确定的反例：种子 50595、第 5 层，4 分钟里每个采样点都合法', () => {
    const { clock, roamer, actor } = setup(50595);
    const space = spaceOf(5);
    roamer.add('a', slot(5, 0));
    roamer.add('b', slot(5, 1));
    let smallest = Infinity;
    for (let t = 0; t < 240_000; t += 50) {
      clock.advance(50);
      const a = actor('a');
      const b = actor('b');
      smallest = Math.min(smallest, rectGap(envelope(a), envelope(b)));
      expect(isLegal(space, a, b) && isLegal(space, b, a), `t=${t}ms`).toBe(true);
    }
    // 确实走到过“恰好等于下限”的相遇（净距与下限只差浮点误差），而不是碰巧没遇到。
    expect(smallest).toBeGreaterThan(REQUIRED_GAP - GAP_EPSILON);
    expect(smallest).toBeLessThanOrEqual(REQUIRED_GAP);
  });

  it('两只同速平行移动、净距恰为下限：任意插值点都合法；净距真的少了一点点就不合法', () => {
    const space = spaceOf(5);
    const [x0, y0] = space.navigable;
    const hw = (envelope({ x: 0, y: 0, pose: 'rest' })[2] - envelope({ x: 0, y: 0, pose: 'rest' })[0]) / 2;
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 200 }), fc.integer({ min: 0, max: 60 }), fc.integer({ min: 1, max: 300 }), (dx, dy, run) => {
        const ax = x0 + hw + 10 + dx;
        const ay = y0 + 145 + dy;
        const bx = ax + 2 * hw + REQUIRED_GAP;
        for (let k = 0; k <= 1000; k++) {
          const t = k / 1000;
          const a: Actor = { x: ax + run * t * 0.37, y: ay + run * t * 0.11, pose: 'rest' };
          const b: Actor = { x: bx + run * t * 0.37 + 1e-13 * (k % 3 - 1), y: ay + run * t * 0.11, pose: 'rest' };
          expect(isLegal(space, a, b) && isLegal(space, b, a), `t=${t}`).toBe(true);
        }
        const tooClose: Actor = { x: ax + 2 * hw + REQUIRED_GAP - 0.01, y: ay, pose: 'rest' };
        expect(isLegal(space, { x: ax, y: ay, pose: 'rest' }, tooClose)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

describe('planExit / leadingPath（纯函数）', () => {
  const space = spaceOf(2);
  const arb = fc.record({ fx: fc.double({ min: 0, max: 1, noNaN: true }), fy: fc.double({ min: 0, max: 1, noNaN: true }), tool: fc.boolean() });

  it('任意合法起点：走向最近的一端，沿途每个采样点都合法；被挡时 wait', () => {
    const [x0, y0, x1, y1] = space.navigable;
    let moves = 0;
    fc.assert(
      fc.property(arb, arb, (selfRaw, otherRaw) => {
        const at = (r: typeof selfRaw): Actor => ({
          x: Math.round(x0 + 70 + r.fx * (x1 - x0 - 140)),
          y: Math.round(y0 + 180 + r.fy * (y1 - y0 - 180)),
          pose: r.tool ? 'tool' : 'rest',
        });
        const self = at(selfRaw);
        const other = at(otherRaw);
        fc.pre(isLegal(space, self, other) && isLegal(space, other, self));
        const r = planExit(space, self, other);
        if (r.kind === 'wait') {
          expect(r.keep).toEqual(self);
          return;
        }
        moves++;
        const prefix = leadingPath(r.path, 100);
        expect(pathLength(prefix)).toBeLessThanOrEqual(100 + 1e-6);
        for (const path of [r.path, prefix]) {
          for (let i = 1; i < path.length; i++) {
            const [ax, ay] = path[i - 1]!;
            const [bx, by] = path[i]!;
            const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 4));
            for (let k = 0; k <= n; k++) {
              const p: Actor = { x: ax + ((bx - ax) * k) / n, y: ay + ((by - ay) * k) / n, pose: self.pose };
              expect(isLegal(space, p, other)).toBe(true);
            }
          }
        }
      }),
      { numRuns: 200 },
    );
    expect(moves).toBeGreaterThan(50);
  });

  it('leadingPath：不超过上限；比上限短的路径原样返回；起点保持不变', () => {
    const path: Point[] = [[0, 0], [30, 0], [30, 40]];
    expect(leadingPath(path, 1000)).toEqual(path);
    const cut = leadingPath(path, 50);
    expect(cut[0]).toEqual([0, 0]);
    expect(pathLength(cut)).toBeCloseTo(50, 6);
    expect(cut.at(-1)).toEqual([30, 20]);
    expect(leadingPath([[5, 5]], 10)).toEqual([[5, 5]]);
  });
});

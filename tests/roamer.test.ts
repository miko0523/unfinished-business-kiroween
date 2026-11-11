import { describe, expect, it } from 'vitest';
import { createRoamer, type RoamSink } from '../src/animation/schedule';
import type { SlotId } from '../src/domain/types';
import { floorModuleForFloor } from '../src/house/assets';
import { FLOOR_SLOTS, type Point } from '../src/house/data/slots';
import { FLOOR_SPACES } from '../src/house/data/space';
import { isLegal, type Actor, type Pose } from '../src/house/motion';
import { createFakeClock, seeded } from './helpers/clock';

const home = (s: SlotId): Point => {
  const f = FLOOR_SLOTS[floorModuleForFloor(s.floor)];
  return (s.slot === 0 ? f.left : f.right).idle;
};

interface PlayRec { id: string; offsets: readonly Point[]; dur: number; at: number }

function setup(seed: number, reduced = false) {
  const clock = createFakeClock();
  const poses = new Map<string, Pose>();
  const plays: PlayRec[] = [];
  const sink: RoamSink = {
    play: (id, offsets, dur) => void plays.push({ id, offsets, dur, at: clock.now() }),
    place() {},
    pose: (id, p) => void poses.set(id, p),
  };
  const roamer = createRoamer({
    clock,
    rand: seeded(seed),
    sink,
    spaceOf: (f) => FLOOR_SPACES[floorModuleForFloor(f)],
    homeOf: home,
    reduced,
  });
  return { clock, roamer, poses, plays };
}

const A: SlotId = { floor: 2, slot: 0 };
const B: SlotId = { floor: 2, slot: 1 };

describe('住客活动调度（假计时器模拟）', () => {
  it('10 分钟模拟：全程每个采样点都合法且不重叠；两只都到过不同高度与左右两端，各自进过对方原本的半边', () => {
    const { clock, roamer, poses } = setup(7);
    const space = FLOOR_SPACES['floor-01'];
    roamer.add('a', A);
    roamer.add('b', B);
    const seenX = { a: [] as number[], b: [] as number[] };
    const seenY = { a: [] as number[], b: [] as number[] };
    let met = false;
    for (let t = 0; t < 600_000; t += 50) {
      clock.advance(50);
      const pa = roamer.positionOf('a')!;
      const pb = roamer.positionOf('b')!;
      const ea: Actor = { x: pa[0], y: pa[1], pose: poses.get('a') ?? 'rest' };
      const eb: Actor = { x: pb[0], y: pb[1], pose: poses.get('b') ?? 'rest' };
      expect(isLegal(space, ea, eb)).toBe(true);
      expect(isLegal(space, eb, ea)).toBe(true);
      seenX.a.push(pa[0]); seenX.b.push(pb[0]); seenY.a.push(pa[1]); seenY.b.push(pb[1]);
      if (poses.get('a') === 'greet' || poses.get('a') === 'tool') met = true;
    }
    // 两只合起来到过左右两端；每一只各自走过很宽的范围和不同的高度（不被锁在 Home 附近的小框里）。
    expect(Math.min(...seenX.a, ...seenX.b)).toBeLessThan(200);
    expect(Math.max(...seenX.a, ...seenX.b)).toBeGreaterThan(560);
    for (const k of ['a', 'b'] as const) {
      expect(Math.max(...seenX[k]) - Math.min(...seenX[k])).toBeGreaterThan(200);
      expect(Math.max(...seenY[k]) - Math.min(...seenY[k])).toBeGreaterThan(60);
    }
    // 允许经过对方原本的半边（房间高度放不下两只上下错身，所以左右次序不会互换，但各自都进过对方的半边）。
    expect(Math.max(...seenX.a)).toBeGreaterThan(420);
    expect(Math.min(...seenX.b)).toBeLessThan(380);
    expect(met).toBe(true);
  });

  it('五层都一样：单独一只也全程合法', () => {
    for (const floor of [2, 3, 4, 5, 6] as const) {
      const { clock, roamer } = setup(floor);
      const space = FLOOR_SPACES[floorModuleForFloor(floor)];
      roamer.add('x', { floor, slot: 1 });
      for (let t = 0; t < 120_000; t += 100) {
        clock.advance(100);
        const p = roamer.positionOf('x')!;
        expect(isLegal(space, { x: p[0], y: p[1], pose: 'rest' }, null)).toBe(true);
      }
    }
  });

  it('选中后停在当下位置，另一只继续活动；取消选中后恢复', () => {
    const { clock, roamer } = setup(3);
    roamer.add('a', A);
    roamer.add('b', B);
    clock.advance(9000);
    roamer.select('a');
    const stopped = roamer.positionOf('a')!;
    const other0 = roamer.positionOf('b')!;
    let otherMoved = false;
    for (let t = 0; t < 60_000; t += 100) {
      clock.advance(100);
      expect(roamer.positionOf('a')).toEqual(stopped);
      const p = roamer.positionOf('b')!;
      if (Math.abs(p[0] - other0[0]) > 5) otherMoved = true;
    }
    expect(otherMoved).toBe(true);
    roamer.select(null);
    let moved = false;
    for (let t = 0; t < 60_000 && !moved; t += 100) {
      clock.advance(100);
      const p = roamer.positionOf('a')!;
      moved = Math.abs(p[0] - stopped[0]) + Math.abs(p[1] - stopped[1]) > 5;
    }
    expect(moved).toBe(true);
  });

  it('Reduced Motion：不漫游、不相遇，一直在 Home Anchor', () => {
    const { clock, roamer, poses } = setup(5, true);
    roamer.add('a', A);
    roamer.add('b', B);
    for (let t = 0; t < 120_000; t += 1000) {
      clock.advance(1000);
      expect(roamer.positionOf('a')).toEqual(home(A));
      expect(roamer.positionOf('b')).toEqual(home(B));
    }
    expect(poses.size).toBe(0);
    expect(clock.pending()).toBe(0);
  });

  it('切到 Reduced Motion 时立刻回到 Home；暂停（页面隐藏）时停住不再调度', () => {
    const { clock, roamer } = setup(11);
    roamer.add('a', A);
    clock.advance(20_000);
    roamer.setPaused(true);
    const here = roamer.positionOf('a');
    clock.advance(60_000);
    expect(roamer.positionOf('a')).toEqual(here);
    roamer.setPaused(false);
    roamer.setReduced(true);
    expect(roamer.positionOf('a')).toEqual(home(A));
  });

  it('家务：带道具姿态合法时立刻就绪，不合法时先挪到合法位置，之后收起道具', () => {
    const { clock, roamer, poses } = setup(2);
    const space = FLOOR_SPACES['floor-01'];
    roamer.add('a', A);
    roamer.add('b', B);
    clock.advance(15_000);
    let result: boolean | null = null;
    roamer.chore('a', 1800, (ok) => (result = ok));
    clock.advance(3000);
    expect(result).toBe(true);
    const p = roamer.positionOf('a')!;
    const q = roamer.positionOf('b')!;
    expect(isLegal(space, { x: p[0], y: p[1], pose: 'tool' }, { x: q[0], y: q[1], pose: 'rest' })).toBe(true);
    clock.advance(3000);
    expect(poses.get('a') ?? 'rest').toBe('rest');
  });

  it('新住客搬进被室友占着的家：室友先沿合法路径让位', () => {
    const { clock, roamer } = setup(4);
    const space = FLOOR_SPACES['floor-01'];
    roamer.add('a', A);
    clock.advance(1000);
    // 让 a 走到右边的 Home 附近
    for (let t = 0; t < 120_000; t += 100) {
      clock.advance(100);
      const p = roamer.positionOf('a')!;
      if (Math.abs(p[0] - home(B)[0]) < 60) break;
    }
    roamer.add('b', B);
    for (let t = 0; t < 20_000; t += 50) {
      clock.advance(50);
      const pa = roamer.positionOf('a')!;
      const pb = roamer.positionOf('b')!;
      if (t > 8000) expect(isLegal(space, { x: pa[0], y: pa[1], pose: 'rest' }, { x: pb[0], y: pb[1], pose: 'rest' })).toBe(true);
    }
  });

  it('移除住客后不再调度它', () => {
    const { clock, roamer } = setup(9);
    roamer.add('a', A);
    roamer.remove('a');
    expect(roamer.positionOf('a')).toBeNull();
    clock.advance(30_000);
    expect(clock.pending()).toBe(0);
  });

  it('stopNow：家务举工具期间被选中/切后台，sink 明确收到 rest，且之后不会再自己举起', () => {
    for (const how of ['select', 'pause'] as const) {
      const { clock, roamer, poses } = setup(6);
      roamer.add('a', A);
      clock.advance(5000);
      let ok: boolean | null = null;
      roamer.chore('a', 1800, (r) => (ok = r));
      clock.advance(600);
      expect(ok).toBe(true); // 单只：立即就绪，处于 tool 姿态
      poses.set('a', 'tool'); // 播放层此刻在举工具
      if (how === 'select') roamer.select('a');
      else roamer.setPaused(true);
      expect(poses.get('a')).toBe('rest');
      clock.advance(5000);
      expect(poses.get('a')).toBe('rest');
    }
  });

  it('stopNow：移动中的家务（正走向工具位）被打断后回 rest，不带 tool 包围盒继续寻路', () => {
    for (let seed = 1; seed < 40; seed++) {
      const { clock, roamer, poses, plays } = setup(seed);
      roamer.add('a', A);
      roamer.add('b', B);
      clock.advance(7000);
      const before = plays.length;
      let ok: boolean | null = null;
      roamer.chore('a', 1800, (r) => (ok = r));
      const moving = plays.length > before && plays[plays.length - 1]!.id === 'a';
      if (!moving) continue;
      clock.advance(100);
      expect(ok).toBeNull(); // 还在路上
      roamer.select('a');
      expect(poses.get('a') ?? 'rest').toBe('rest');
      const pos = roamer.positionOf('a')!;
      clock.advance(5000);
      expect(roamer.positionOf('a')).toEqual(pos);
      expect(ok).toBeNull(); // 被打断的家务不会事后“就绪”
      return;
    }
    throw new Error('没有找到需要先挪动的家务场景');
  });

  it('相遇：两条路径按同一个实际时长播放，路径长短不同时按真实时间采样也合法', () => {
    const space = FLOOR_SPACES['floor-01'];
    let checked = 0;
    let unequal = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const { clock, roamer, poses, plays } = setup(seed);
      roamer.add('a', A);
      roamer.add('b', B);
      for (let t = 0; t < 300_000; t += 20) {
        clock.advance(20);
        const pa = roamer.positionOf('a')!;
        const pb = roamer.positionOf('b')!;
        const ea: Actor = { x: pa[0], y: pa[1], pose: poses.get('a') ?? 'rest' };
        const eb: Actor = { x: pb[0], y: pb[1], pose: poses.get('b') ?? 'rest' };
        expect(isLegal(space, ea, eb) && isLegal(space, eb, ea)).toBe(true);
      }
      for (let i = 0; i < plays.length - 1; i++) {
        const x = plays[i]!;
        const y = plays[i + 1]!;
        if (x.at !== y.at || x.id === y.id) continue; // 同一时刻出发的一对 = 相遇
        checked++;
        expect(x.dur).toBe(y.dur);
        const len = (o: readonly Point[]) => o.slice(1).reduce((n, p, k) => n + Math.hypot(p[0] - o[k]![0], p[1] - o[k]![1]), 0);
        if (Math.abs(len(x.offsets) - len(y.offsets)) > 20) unequal++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(unequal).toBeGreaterThan(0);
  });

  it('makeRoom：室友正在移动时，让位路径从它当前的插值位置起步', () => {
    for (let seed = 1; seed < 60; seed++) {
      const { clock, roamer, plays } = setup(seed);
      roamer.add('a', A);
      let found = false;
      for (let t = 0; t < 200_000 && !found; t += 50) {
        clock.advance(50);
        const p = roamer.positionOf('a')!;
        const last = plays.filter((x) => x.id === 'a').at(-1);
        const moving = last !== undefined && clock.now() < last.at + last.dur;
        if (moving && Math.abs(p[0] - home(B)[0]) < 50 && Math.abs(p[1] - home(B)[1]) < 40) found = true;
      }
      if (!found) continue;
      const here = roamer.positionOf('a')!;
      const n = plays.length;
      roamer.add('b', B);
      clock.advance(400);
      const fresh = plays.slice(n).find((x) => x.id === 'a');
      if (!fresh) continue;
      const start = fresh.offsets[0]!;
      expect(start[0] + home(A)[0]).toBeCloseTo(here[0], 5);
      expect(start[1] + home(A)[1]).toBeCloseTo(here[1], 5);
      return;
    }
    throw new Error('没有构造出移动中被占家的场景');
  });
});

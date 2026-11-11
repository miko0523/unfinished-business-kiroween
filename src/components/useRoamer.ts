import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Facing } from '../animation/walk';
import { createRoamer, type Roamer, type RoamSink } from '../animation/schedule';
import type { SlotId, Task } from '../domain/types';
import { homeOnStage } from '../house/anchors';
import { floorModuleForFloor } from '../house/assets';
import { FLOOR_SLOTS, type Point } from '../house/data/slots';
import { FLOOR_SPACES } from '../house/data/space';
import { GHOST_HEIGHT, GHOST_WIDTH } from '../house/ghostShape';
import type { HouseLayout } from '../house/layout';
import type { Pose } from '../house/motion';
import type { AppContext } from '../store/StoreContext';
import { prefersReducedMotion, useReducedMotion } from './useReducedMotion';
import { useWalkFacing } from './useWalkFacing';
import type { RunChore } from './useGhostPlays';

const translate = (dx: number, dy: number) => `translate(${(dx / GHOST_WIDTH) * 100}%, ${(dy / GHOST_HEIGHT) * 100}%)`;

export function homeOnFloor(slot: SlotId): Point {
  const f = FLOOR_SLOTS[floorModuleForFloor(slot.floor)];
  return (slot.slot === 0 ? f.left : f.right).idle;
}

export interface RoamerHandle {
  /** 把每只 Ghost 的外层元素登记给调度器（位移作用在它上面）。 */
  register(id: string, el: HTMLElement | null): void;
  poses: ReadonlyMap<string, Pose>;
  /** 水平漫游时每只 Ghost 的朝向（脸朝前）；停下为 0。 */
  walks: ReadonlyMap<string, Facing>;
  runChore: RunChore;
  /** 定住一只马上要离场的 Ghost（它的 Task 已经不在数据里）。 */
  pin(id: string): void;
  /** 搬走：拿起行李、朝外缘走一小段并淡出，演完后调用 done。 */
  depart(id: string, done: () => void): void;
}

const NOBODY: ReadonlySet<string> = new Set();

/**
 * 把纯逻辑的调度器接到 DOM 上：位移用相对自身尺寸的百分比 transform（WAAPI），
 * 跟随 Reduced_Motion、页面可见性、选中状态与住客增减。
 */
export function useRoamer(
  ctx: AppContext,
  tasks: readonly Task[],
  selectedId: string | null,
  layout: HouseLayout,
  /** 不在 tasks 里、但还要留在调度器里的离场者（庆祝飞离前、搬走演完前）。 */
  keep: ReadonlySet<string> = NOBODY,
  /** 舞台缩得太小、两只的 44px 触控区在漫游中必然叠在一起时，住客留在 Home Anchor（与减少动态时相同的静止，不是应用内开关）。 */
  holdStill = false,
): RoamerHandle {
  const reduced = useReducedMotion() || holdStill;
  const [poses, setPoses] = useState<ReadonlyMap<string, Pose>>(() => new Map());
  const { walks, facing } = useWalkFacing();
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const els = useRef(new Map<string, HTMLElement>());
  const anims = useRef(new Map<string, Animation>());
  const slots = useRef(new Map<string, SlotId>());
  const known = useRef(new Set<string>());
  const roamerRef = useRef<Roamer | null>(null);

  const sink = useMemo<RoamSink>(
    () => ({
      play(id, offsets, durationMs) {
        facing.begin(id, offsets, durationMs);
        const el = els.current.get(id);
        if (!el || typeof el.animate !== 'function') return;
        anims.current.get(id)?.cancel();
        let total = 0;
        const cum = [0];
        for (let i = 1; i < offsets.length; i++) {
          total += Math.hypot(offsets[i]![0] - offsets[i - 1]![0], offsets[i]![1] - offsets[i - 1]![1]);
          cum.push(total);
        }
        const frames = offsets.map((o, i) => ({ transform: translate(o[0], o[1]), offset: total === 0 ? i / Math.max(1, offsets.length - 1) : cum[i]! / total }));
        try {
          const a = el.animate(frames, { duration: durationMs, easing: 'linear', fill: 'forwards' });
          a.finished?.catch(() => {}); // 取消时 finished 会被拒绝，这是正常的
          anims.current.set(id, a);
        } catch {
          /* 动画不可用：位置由 place 在结束时直接给出 */
        }
      },
      place(id, offset) {
        facing.stop(id);
        const el = els.current.get(id);
        if (!el) return;
        el.style.transform = translate(offset[0], offset[1]);
        anims.current.get(id)?.cancel();
        anims.current.delete(id);
      },
      pose(id, pose) {
        setPoses((prev) => (prev.get(id) === pose ? prev : new Map(prev).set(id, pose)));
      },
      fade(id, durationMs) {
        const el = els.current.get(id);
        if (!el || typeof el.animate !== 'function') return;
        try {
          const a = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: durationMs, easing: 'ease-in', fill: 'forwards' });
          a.finished?.catch(() => {});
        } catch {
          /* 动画不可用：离场结束后元素本来就会被移除 */
        }
      },
    }),
    [facing],
  );

  // 调度器：整个组件生命周期一个。
  useEffect(() => {
    const roamer = createRoamer({
      clock: {
        now: () => performance.now(),
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (h) => clearTimeout(h as number),
      },
      rand: Math.random,
      sink,
      spaceOf: (floor) => FLOOR_SPACES[floorModuleForFloor(floor)],
      homeOf: homeOnFloor,
      reduced: prefersReducedMotion(),
    });
    roamerRef.current = roamer;
    const previousLookup = ctx.roam.positionOf;
    ctx.roam.positionOf = (id) => {
      const p = roamer.positionOf(id);
      const slot = slots.current.get(id);
      if (!p || !slot) return null;
      // 每次用当前 layout 现算舞台原点（楼层模块的舞台位置），再叠加楼层内坐标。
      const home = homeOnStage(layoutRef.current, slot);
      if (!home) return null;
      const floorHome = homeOnFloor(slot);
      return [home.x - floorHome[0] + p[0], home.y - floorHome[1] + p[1]];
    };
    const onVisibility = () => roamer.setPaused(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      ctx.roam.positionOf = previousLookup;
      roamer.dispose();
      facing.reset();
      roamerRef.current = null;
      known.current.clear();
      slots.current.clear();
      for (const a of anims.current.values()) a.cancel();
      anims.current.clear();
    };
  }, [ctx, sink, facing]);

  useEffect(() => roamerRef.current?.setReduced(reduced), [reduced]);
  useEffect(() => roamerRef.current?.select(selectedId), [selectedId]);

  // 住客增减 → 调度器。先送走离开的，再接纳新来的，这样新住客搬进刚腾出的家时，旧的已经不在了。
  useEffect(() => {
    const roamer = roamerRef.current;
    if (!roamer) return;
    const ids = new Set(tasks.map((x) => x.id));
    for (const id of [...known.current]) {
      if (ids.has(id) || keep.has(id)) continue;
      known.current.delete(id);
      slots.current.delete(id);
      roamer.remove(id);
      els.current.delete(id);
      anims.current.delete(id);
    }
    for (const task of tasks) {
      if (known.current.has(task.id)) continue;
      known.current.add(task.id);
      slots.current.set(task.id, task.slot);
      roamer.add(task.id, task.slot);
    }
  }, [tasks, keep]);

  const runChore = useMemo<RunChore>(
    () => (id, ms, ready) => {
      const roamer = roamerRef.current;
      if (roamer) roamer.chore(id, ms, ready);
      else ready(true);
    },
    [],
  );
  const register = useMemo(
    () => (id: string, el: HTMLElement | null) => {
      if (!el || els.current.get(id) === el) return;
      els.current.set(id, el);
      // 同一只 Ghost 换了一个元素（例如从列表项变成离场的演员）：新元素接着旧元素的位置。
      const p = roamerRef.current?.positionOf(id);
      const slot = slots.current.get(id);
      if (p && slot) {
        const home = homeOnFloor(slot);
        el.style.transform = translate(p[0] - home[0], p[1] - home[1]);
      }
    },
    [],
  );
  const pin = useMemo(() => (id: string) => roamerRef.current?.pin(id), []);
  const depart = useMemo(
    () => (id: string, done: () => void) => {
      const roamer = roamerRef.current;
      if (roamer) roamer.depart(id, done);
      else done();
    },
    [],
  );

  return { register, poses, walks, runChore, pin, depart };
}

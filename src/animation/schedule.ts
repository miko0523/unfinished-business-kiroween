// 住客活动调度：同层两只 Ghost 在整层共享空间里漫游，偶尔相遇；被选中时停在当下合法位置。
// 纯逻辑：时钟、随机数与“把位移交给谁播放”（sink）都由调用方注入，所以不碰 DOM，可以用假计时器模拟。
// 同一层同一时刻至多一只在自由移动，另一只静止；相遇由 planMeet 一次性校验双方路径。
import type { SlotId } from '../domain/types';
import type { FloorSpace } from '../house/data/space';
import type { Point } from '../house/data/slots';
import { isLegal, leadingPath, nearestToolSpot, pathLength, pickGoal, planExit, planMeet, planMove, pointAlong, type Actor, type Pose } from '../house/motion';

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface RoamSink {
  /** 沿折线播放位移。offsets 是相对 Home Anchor 的偏移（楼层逻辑像素）。 */
  play(id: string, offsets: readonly Point[], durationMs: number): void;
  /** 静止在某个偏移处（取消正在播放的位移）。 */
  place(id: string, offset: Point): void;
  /** 姿态变化（打招呼、一起做家务、收起）。 */
  pose(id: string, pose: Pose): void;
  /** 搬走时淡出，durationMs 毫秒内由不透明到透明（只动 opacity）。 */
  fade?(id: string, durationMs: number): void;
}

export interface RoamerOptions {
  clock: Clock;
  rand: () => number;
  sink: RoamSink;
  /** 该层的共享空间；返回 null 表示这一层没有可导航区，Ghost 只停在 Home Anchor。 */
  spaceOf(floor: SlotId['floor']): FloorSpace | null;
  /** 住客位的 Home Anchor（楼层逻辑像素）。 */
  homeOf(slot: SlotId): Point;
  /** 初始是否为 Reduced_Motion（固定在 Home Anchor，不漫游、不相遇）。 */
  reduced?: boolean;
}

export const SPEED = 60; // 逻辑像素 / 秒
const MIN_MOVE_MS = 700;
const PAUSE_MIN = 600;
const PAUSE_SPAN = 1400;
const MEET_AFTER_MIN = 20000;
const MEET_AFTER_SPAN = 20000;
const MEET_HOLD_MS = 2400;
const CHORE_WAIT_LIMIT = 2000;
const RETRY_MS = 300;
// 搬走（MovedOutQuietly 共 1.5 秒）：先在原位拿起行李，再朝最近的外缘走一小段并淡出。
const DEPART_LIFT_MS = 500;
const DEPART_LIFT_WAIT_MS = 400;
const DEPART_WALK_MS = 1000;
const DEPART_SPEED = 100;
const DEPART_REACH = 100;

interface Move {
  path: Point[];
  t0: number;
  dur: number;
  next: Actor;
  timer: unknown;
  onDone: (() => void) | null;
}

interface Ghost {
  id: string;
  slot: SlotId;
  home: Point;
  actor: Actor;
  move: Move | null;
  hold: unknown | null;
  partner: string | null;
  /** 已被定住：确认或搬走之后、还没离场的那一小段时间。它不再自己活动，但仍是室友要避开的障碍。 */
  pinned: boolean;
}

interface FloorState {
  timer: unknown | null;
  nextMeetAt: number;
}

export interface Roamer {
  add(id: string, slot: SlotId): void;
  remove(id: string): void;
  select(id: string | null): void;
  /** 定住：停在当下位置，不再活动；室友继续按规则避开它。用于确认后的庆祝与搬走。 */
  pin(id: string): void;
  /**
   * 搬走：先定住，原位拿起行李（必要时延后，最多 0.4 秒），再沿合法路径朝最近的外缘走一小段并淡出；
   * 全程约 1.5 秒后调用 done。Reduced Motion、页面隐藏或没有可导航区时立刻调用 done。
   */
  depart(id: string, done: () => void): void;
  setReduced(reduced: boolean): void;
  setPaused(paused: boolean): void;
  /** 当前位置（楼层逻辑像素，播放中按时间插值）；不存在返回 null。 */
  positionOf(id: string): Point | null;
  /**
   * 要做家务：必要时先挪到带道具也合法的位置。准备好时调用 ready(true)；
   * 等待超过 2 秒仍不合法则调用 ready(false)，调用方只保留颜色与文字变化。
   * ready(true) 之后 durMs 毫秒内保持道具姿态，随后收起。
   */
  chore(id: string, durMs: number, ready: (ok: boolean) => void): void;
  dispose(): void;
}

export function createRoamer(opts: RoamerOptions): Roamer {
  const { clock, rand, sink } = opts;
  const ghosts = new Map<string, Ghost>();
  const floors = new Map<number, FloorState>();
  let selectedId: string | null = null;
  let reduced = opts.reduced === true;
  let paused = false;
  let disposed = false;
  const departing = new Map<string, () => void>();

  const active = () => !reduced && !paused && !disposed;
  const offsetOf = (g: Ghost, p: Point): Point => [p[0] - g.home[0], p[1] - g.home[1]];
  const onFloor = (floor: number) => [...ghosts.values()].filter((g) => g.slot.floor === floor);
  const mateOf = (g: Ghost): Ghost | null => onFloor(g.slot.floor).find((o) => o !== g) ?? null;
  const spaceFor = (g: Ghost) => opts.spaceOf(g.slot.floor);
  const busy = (g: Ghost) => g.move !== null || g.hold !== null;
  const floorState = (floor: number): FloorState => {
    let f = floors.get(floor);
    if (!f) {
      f = { timer: null, nextMeetAt: Infinity };
      floors.set(floor, f);
    }
    return f;
  };

  const position = (g: Ghost): Point => {
    const m = g.move;
    if (!m) return [g.actor.x, g.actor.y];
    const t = Math.min(1, Math.max(0, (clock.now() - m.t0) / m.dur));
    return pointAlong(m.path, t);
  };

  const schedule = (floor: number, ms: number) => {
    const fs = floorState(floor);
    if (fs.timer !== null) clock.clearTimeout(fs.timer);
    fs.timer = null;
    if (!active()) return;
    fs.timer = clock.setTimeout(() => {
      fs.timer = null;
      tick(floor);
    }, ms);
  };

  const pause = () => PAUSE_MIN + rand() * PAUSE_SPAN;

  const startMove = (g: Ghost, path: Point[], next: Actor, onDone: (() => void) | null, minMs = MIN_MOVE_MS, speed = SPEED) => {
    const dur = Math.max(minMs, (pathLength(path) / speed) * 1000);
    const m: Move = { path, t0: clock.now(), dur, next, timer: null, onDone };
    g.move = m;
    sink.play(g.id, path.map((p) => offsetOf(g, p)), dur);
    m.timer = clock.setTimeout(() => {
      if (g.move !== m) return;
      g.move = null;
      g.actor = next;
      sink.place(g.id, offsetOf(g, [next.x, next.y]));
      m.onDone?.();
    }, dur);
  };

  /** 立刻停在当下位置（取消位移与停留）；返回是否真的停了什么。 */
  const stopNow = (g: Ghost) => {
    if (g.move) {
      const here = position(g);
      clock.clearTimeout(g.move.timer);
      g.move = null;
      g.actor = { x: here[0], y: here[1], pose: g.actor.pose };
      sink.place(g.id, offsetOf(g, here));
    }
    if (g.hold !== null) {
      clock.clearTimeout(g.hold);
      g.hold = null;
    }
    if (g.partner !== null) {
      const p = ghosts.get(g.partner);
      g.partner = null;
      if (p) {
        p.partner = null;
        stopNow(p);
      }
    }
    // 无论因何停止（选中、切后台、打断家务、清 hold），都回 rest pose，不再举着工具。
    restPose(g);
  };

  const restPose = (g: Ghost) => {
    if (g.actor.pose !== 'rest') {
      g.actor = { ...g.actor, pose: 'rest' };
      sink.pose(g.id, 'rest');
    }
  };

  /** 结束一次搬走（只调用一次 done）。 */
  const finishDeparture = (id: string) => {
    const done = departing.get(id);
    if (!done) return;
    departing.delete(id);
    done();
  };

  function tick(floor: number) {
    if (!active()) return;
    const space = opts.spaceOf(floor as SlotId['floor']);
    const gs = onFloor(floor);
    if (!space || gs.length === 0) return;
    if (gs.some(busy)) return schedule(floor, RETRY_MS);
    const free = gs.filter((g) => g.id !== selectedId && !g.pinned);
    if (free.length === 0) return schedule(floor, 800);
    const fs = floorState(floor);

    if (gs.length === 2 && free.length === 2 && clock.now() >= fs.nextMeetAt) {
      const spot = space.actionSpots[Math.floor(rand() * space.actionSpots.length)];
      const [a, b] = gs as [Ghost, Ghost];
      const r = spot ? planMeet(space, a.actor, b.actor, spot) : ({ kind: 'wait' } as const);
      if (r.kind === 'meet') {
        fs.nextMeetAt = Infinity;
        a.partner = b.id;
        b.partner = a.id;
        let arrived = 0;
        const arrive = () => {
          arrived += 1;
          if (arrived < 2) return;
          sink.pose(a.id, r.nextA.pose);
          sink.pose(b.id, r.nextB.pose);
          const hold = clock.setTimeout(() => {
            a.hold = null;
            b.hold = null;
            a.partner = null;
            b.partner = null;
            restPose(a);
            restPose(b);
            fs.nextMeetAt = clock.now() + MEET_AFTER_MIN + rand() * MEET_AFTER_SPAN;
            schedule(floor, pause());
          }, MEET_HOLD_MS);
          a.hold = hold;
          b.hold = hold;
        };
        // 两条路径按同一个时长播放：planMeet 用同一归一化 t 验证安全，真实动画必须一致。
        const dur = Math.max(1200, (Math.max(pathLength(r.pathA), pathLength(r.pathB)) / SPEED) * 1000);
        startMove(a, r.pathA, r.nextA, arrive, dur);
        startMove(b, r.pathB, r.nextB, arrive, dur);
        return;
      }
      fs.nextMeetAt = clock.now() + 3000;
    }

    const mover = free[Math.floor(rand() * free.length)]!;
    const other = mateOf(mover);
    const r = planMove(space, mover.actor, other ? other.actor : null, pickGoal(space, rand));
    if (r.kind === 'move') startMove(mover, r.path, r.next, () => schedule(floor, pause()));
    else schedule(floor, RETRY_MS);
  }

  const toHome = (g: Ghost) => {
    g.actor = { x: g.home[0], y: g.home[1], pose: 'rest' };
    sink.place(g.id, [0, 0]);
  };

  /** 新住客的 Home Anchor 被室友占着时，室友先沿合法路径回自己的家。 */
  const makeRoom = (newcomer: Ghost) => {
    const mate = mateOf(newcomer);
    const space = spaceFor(newcomer);
    // 室友正站在小舞台上（被选中）：它的位置先留着，不去挪它。
    if (mate && mate.id === selectedId) return;
    if (!mate || !space || isLegal(space, newcomer.actor, mate.actor)) return;
    stopNow(mate);
    const attempt = () => {
      if (disposed || !ghosts.has(mate.id) || !ghosts.has(newcomer.id)) return;
      if (isLegal(space, newcomer.actor, mate.actor)) return;
      const r = planMove(space, mate.actor, newcomer.actor, { x: mate.home[0], y: mate.home[1], pose: 'rest' });
      if (r.kind === 'move') startMove(mate, r.path, r.next, () => schedule(mate.slot.floor, pause()));
      else clock.setTimeout(attempt, RETRY_MS);
    };
    attempt();
  };

  return {
    add(id, slot) {
      if (ghosts.has(id)) return;
      const home = opts.homeOf(slot);
      const g: Ghost = { id, slot, home, actor: { x: home[0], y: home[1], pose: 'rest' }, move: null, hold: null, partner: null, pinned: false };
      ghosts.set(id, g);
      const fs = floorState(slot.floor);
      if (onFloor(slot.floor).length === 2) fs.nextMeetAt = clock.now() + MEET_AFTER_MIN + rand() * MEET_AFTER_SPAN;
      if (!active() || !spaceFor(g)) return;
      makeRoom(g);
      schedule(slot.floor, 1500 + rand() * 2500);
    },
    remove(id) {
      const g = ghosts.get(id);
      if (!g) return;
      stopNow(g);
      ghosts.delete(id);
      departing.delete(id);
      if (selectedId === id) selectedId = null;
      floorState(g.slot.floor).nextMeetAt = Infinity;
      if (onFloor(g.slot.floor).length > 0) schedule(g.slot.floor, pause());
    },
    select(id) {
      selectedId = id;
      if (id) {
        const g = ghosts.get(id);
        if (g) stopNow(g);
      }
      for (const f of floors.keys()) schedule(f, 800);
    },
    pin(id) {
      const g = ghosts.get(id);
      if (!g || g.pinned) return;
      g.pinned = true;
      stopNow(g);
      schedule(g.slot.floor, 800);
    },
    depart(id, done) {
      const g = ghosts.get(id);
      const space = g ? spaceFor(g) : null;
      if (!g) return done();
      g.pinned = true;
      stopNow(g);
      if (!active() || !space) return done();
      departing.set(id, done);
      const floor = g.slot.floor;
      const mate = mateOf(g);
      // 室友停在当下位置；搬走期间这一层的 tick 看到有人在忙，不会去动它。
      if (mate) stopNow(mate);
      const mateActor = () => (mate && ghosts.has(mate.id) ? mate.actor : null);
      const started = clock.now();
      const end = () => {
        if (ghosts.has(id)) schedule(floor, pause());
        finishDeparture(id);
      };
      const walk = () => {
        if (!departing.has(id) || !ghosts.has(id)) return;
        sink.fade?.(id, DEPART_WALK_MS);
        const r = planExit(space, g.actor, mateActor());
        if (r.kind !== 'move') {
          // 去路被挡：原地淡出，不穿过任何东西。
          g.hold = clock.setTimeout(() => {
            g.hold = null;
            end();
          }, DEPART_WALK_MS);
          return;
        }
        const path = leadingPath(r.path, DEPART_REACH);
        const last = path[path.length - 1]!;
        startMove(g, path, { ...g.actor, x: last[0], y: last[1] }, end, DEPART_WALK_MS, DEPART_SPEED);
      };
      const lift = () => {
        if (!departing.has(id) || !ghosts.has(id)) return;
        g.hold = null;
        const lifted: Actor = { ...g.actor, pose: 'tool' };
        if (isLegal(space, lifted, mateActor())) {
          g.actor = lifted;
          sink.pose(id, 'tool');
          g.hold = clock.setTimeout(() => {
            g.hold = null;
            walk();
          }, DEPART_LIFT_MS);
          return;
        }
        if (clock.now() - started >= DEPART_LIFT_WAIT_MS) return walk();
        g.hold = clock.setTimeout(lift, 100);
      };
      lift();
    },
    setReduced(next) {
      if (next === reduced) return;
      reduced = next;
      if (reduced) {
        for (const g of ghosts.values()) {
          stopNow(g);
          toHome(g);
          sink.pose(g.id, 'rest');
        }
        for (const f of floors.values()) if (f.timer !== null) clock.clearTimeout(f.timer), (f.timer = null);
        for (const id of [...departing.keys()]) finishDeparture(id);
      } else for (const f of floors.keys()) schedule(f, 1500);
    },
    setPaused(next) {
      if (next === paused) return;
      paused = next;
      if (paused) {
        for (const g of ghosts.values()) stopNow(g);
        for (const f of floors.values()) if (f.timer !== null) clock.clearTimeout(f.timer), (f.timer = null);
        for (const id of [...departing.keys()]) finishDeparture(id);
      } else for (const f of floors.keys()) schedule(f, 800);
    },
    positionOf(id) {
      const g = ghosts.get(id);
      return g ? position(g) : null;
    },
    chore(id, durMs, ready) {
      const g = ghosts.get(id);
      if (!g) return ready(false);
      const space = spaceFor(g);
      const mate = mateOf(g);
      if (!space) return ready(true); // 没有可导航区：停在 Home Anchor，原地做
      // 正在离场的室友（庆祝或搬走）不能被打断：等它走完，或等不到就略过动作动画。
      if (mate && !mate.pinned) {
        stopNow(mate);
        restPose(mate);
      }
      stopNow(g);
      const floor = g.slot.floor;
      const started = clock.now();
      const finish = () => {
        g.actor = { ...g.actor, pose: 'tool' };
        ready(true);
        g.hold = clock.setTimeout(() => {
          g.hold = null;
          restPose(g);
          schedule(floor, pause());
        }, durMs);
      };
      const go = () => {
        g.hold = null;
        // 被选中的 Ghost 此刻站在抽屉上沿的小舞台上：家务就在原地演，不在屋里挪动（屋里的位置留给它飞回来）。
        if (selectedId === id) return finish();
        const other: Actor | null = mate && ghosts.has(mate.id) ? { ...mate.actor, x: position(mate)[0], y: position(mate)[1] } : null;
        const blocked = mate !== null && mate.pinned && busy(mate);
        const here: Actor = { x: g.actor.x, y: g.actor.y, pose: 'tool' };
        if (!blocked && isLegal(space, here, other)) return finish();
        if (!blocked) {
          const r = planMove(space, { ...g.actor, pose: 'rest' }, other, nearestToolSpot(space, [g.actor.x, g.actor.y]));
          if (r.kind === 'move') return startMove(g, r.path, r.next, finish, 300);
        }
        if (clock.now() - started >= CHORE_WAIT_LIMIT) {
          ready(false);
          schedule(floor, pause());
          return;
        }
        g.hold = clock.setTimeout(go, RETRY_MS);
      };
      go();
    },
    dispose() {
      disposed = true;
      for (const f of floors.values()) if (f.timer !== null) clock.clearTimeout(f.timer);
      for (const g of ghosts.values()) {
        if (g.move) clock.clearTimeout(g.move.timer);
        if (g.hold !== null) clock.clearTimeout(g.hold);
      }
      ghosts.clear();
    },
  };
}

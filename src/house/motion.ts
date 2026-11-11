// 住客活动的纯函数：包围盒、连续碰撞检查、绕行与等待、相遇。
// 坐标：单张 801 宽 1x 楼层 PNG 的左上角为原点，Ghost 锚点取身体底边中点。
// 规则（design.md「活动规则」）：全程（不只终点）满足三条——不出可导航区、两只不重叠且净距不小于 REQUIRED_GAP、
// 不碰显式障碍。Static_Layer 的背景图案不参与碰撞。被拒绝的移动返回上一帧的合法位置（wait）。
import { ENVELOPES } from './data/slots';
import type { FloorSpace } from './data/space';
import type { Point, Rect } from './data/slots';

export type Pose = 'rest' | 'greet' | 'tool';

export interface Actor {
  x: number;
  y: number;
  pose: Pose;
}

export interface Goal {
  x: number;
  y: number;
  pose: Pose;
}

/** 采样步长（逻辑像素）：沿路径每隔不超过它检查一次。 */
export const SAMPLE_STEP = 4;
/** 两只 envelope 之间的最小净距。 */
export const REQUIRED_GAP = 8;
/**
 * 判定净距时容许的浮点误差（逻辑像素，百万分之一像素，肉眼与布局都不可见）。
 * 动作位的两端、Home Anchor 与取整后的漫游目标，都可能让两只“恰好”相距 REQUIRED_GAP；两只沿平行路径同步移动时，
 * 这段净距在数学上始终等于 REQUIRED_GAP，但两条插值各自带着约 1e-14 的舍入误差，逐点比较时会得到 7.99999999999996。
 * 不是间距不够，是同一个数的两种舍入，所以判定不能把它当违规。
 */
export const GAP_EPSILON = 1e-6;

export type MoveResult =
  | { kind: 'move'; path: Point[]; next: Actor }
  | { kind: 'wait'; keep: Actor };

export interface MeetSpot {
  kind: 'greet' | 'work';
  a: Point;
  b: Point;
}

export type MeetResult =
  | { kind: 'meet'; pathA: Point[]; pathB: Point[]; nextA: Actor; nextB: Actor }
  | { kind: 'wait' };

function halfWidthOf(pose: Pose): number {
  return pose === 'tool' ? ENVELOPES.choreWithTool.halfWidth : ENVELOPES.idleOrGreet.halfWidth;
}

function heightOf(pose: Pose): number {
  return pose === 'tool' ? ENVELOPES.choreWithTool.height : ENVELOPES.idleOrGreet.height;
}

/** 锚点与姿态给出的矩形 [x−半宽, y−高, x+半宽, y]，已计入两只手与当前动作道具。 */
export function envelope(a: Actor): Rect {
  const hw = halfWidthOf(a.pose);
  return [a.x - hw, a.y - heightOf(a.pose), a.x + hw, a.y];
}

/** 两个矩形的净距：任一轴上分离的距离的较大者；为负表示重叠。 */
export function rectGap(a: Rect, b: Rect): number {
  const dx = Math.max(a[0] - b[2], b[0] - a[2]);
  const dy = Math.max(a[1] - b[3], b[1] - a[3]);
  return Math.max(dx, dy);
}

export function requiredGap(): number {
  return REQUIRED_GAP;
}

export function rectOverlaps(a: Rect, b: Rect): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

function inside(inner: Rect, outer: Rect): boolean {
  return inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
}

/** 单个位置是否合法：界内、不碰障碍、与对方净距足够。 */
export function isLegal(space: FloorSpace, a: Actor, other: Actor | null): boolean {
  const env = envelope(a);
  if (!inside(env, space.navigable)) return false;
  for (const o of space.obstacles) if (rectOverlaps(env, o)) return false;
  if (other && rectGap(env, envelope(other)) < REQUIRED_GAP - GAP_EPSILON) return false;
  return true;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function lerp(a: Point, b: Point, t: number): Point {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** 折线上的位置（按弧长比例 t∈[0,1]）。 */
export function pointAlong(path: readonly Point[], t: number): Point {
  if (path.length === 0) throw new Error('empty path');
  if (path.length === 1 || t <= 0) return path[0]!;
  const total = pathLength(path);
  if (t >= 1 || total === 0) return path[path.length - 1]!;
  let left = t * total;
  for (let i = 1; i < path.length; i++) {
    const seg = dist(path[i - 1]!, path[i]!);
    if (left <= seg) return lerp(path[i - 1]!, path[i]!, seg === 0 ? 0 : left / seg);
    left -= seg;
  }
  return path[path.length - 1]!;
}

export function pathLength(path: readonly Point[]): number {
  let n = 0;
  for (let i = 1; i < path.length; i++) n += dist(path[i - 1]!, path[i]!);
  return n;
}

/**
 * 沿折线逐点检查（步长不超过 SAMPLE_STEP，含起点与终点）。
 * 起点本来就与对方过近时（例如新住客刚搬进来），允许在“已经拉开之前”忽略对方，一旦拉开就必须保持。
 */
function pathClear(space: FloorSpace, pose: Pose, path: readonly Point[], other: Actor | null, escaping: boolean): boolean {
  let ignoreOther = escaping;
  for (let i = 0; i < path.length; i++) {
    const from = path[i]!;
    const to = i + 1 < path.length ? path[i + 1]! : from;
    const steps = Math.max(1, Math.ceil(dist(from, to) / SAMPLE_STEP));
    for (let s = 0; s <= steps; s++) {
      if (i + 1 < path.length && s === steps) continue; // 终点由下一段的起点检查
      const p = s === 0 ? from : lerp(from, to, s / steps);
      const probe: Actor = { x: p[0], y: p[1], pose };
      if (ignoreOther) {
        if (isLegal(space, probe, other)) ignoreOther = false;
        else if (!isLegal(space, probe, null)) return false;
      } else if (!isLegal(space, probe, other)) return false;
    }
  }
  return true;
}

const GRID_STEP = 40;

function waypoints(space: FloorSpace): Point[] {
  const [x0, y0, x1, y1] = space.navigable;
  const out: Point[] = [];
  for (let y = y0; y <= y1; y += GRID_STEP) for (let x = x0; x <= x1; x += GRID_STEP) out.push([x, y]);
  for (const s of space.actionSpots) out.push(s.a, s.b);
  for (const h of space.homes) out.push(h);
  return out;
}

/**
 * 计划一次移动：先试直线，被挡时尝试经一个中转点的折线，否则返回 wait（保持上一帧的合法位置与姿态）。
 * 移动途中的姿态取起点与终点中较大者的“行走姿态”：带道具的姿态只在到达时生效，所以途中按 rest 检查，
 * 但若出发时本来就带道具，则途中也按该姿态检查。
 */
export function planMove(space: FloorSpace, self: Actor, other: Actor | null, goal: Goal): MoveResult {
  const wait: MoveResult = { kind: 'wait', keep: self };
  const target: Actor = { x: goal.x, y: goal.y, pose: goal.pose };
  if (!isLegal(space, target, other)) return wait;
  const travel: Pose = self.pose === 'tool' ? 'tool' : 'rest';
  const escaping = other !== null && !isLegal(space, self, other);
  const start: Point = [self.x, self.y];
  const end: Point = [goal.x, goal.y];

  const direct = [start, end];
  if (pathClear(space, travel, direct, other, escaping)) return { kind: 'move', path: direct, next: target };

  const candidates = waypoints(space)
    .map((w) => ({ w, len: dist(start, w) + dist(w, end) }))
    .sort((p, q) => p.len - q.len)
    .slice(0, 24);
  for (const { w } of candidates) {
    const path = [start, w, end];
    if (pathClear(space, travel, path, other, escaping)) return { kind: 'move', path, next: target };
  }
  return wait;
}

/** 从可导航区里挑一个漫游目标（空手姿态）；覆盖窗边、床边、房间中央与半空。 */
export function pickGoal(space: FloorSpace, rand: () => number): Goal {
  const hw = halfWidthOf('rest');
  const h = heightOf('rest');
  const [x0, y0, x1, y1] = space.navigable;
  const xMin = x0 + hw;
  const xMax = x1 - hw;
  const yMin = y0 + h;
  const yMax = y1;
  return {
    x: Math.round(xMin + rand() * (xMax - xMin)),
    y: Math.round(yMin + rand() * (yMax - yMin)),
    pose: 'rest',
  };
}

/** 离 (x,y) 最近的、带道具姿态也在界内的位置（只做夹取，合法性仍由 planMove 检查）。 */
export function nearestToolSpot(space: FloorSpace, from: Point): Goal {
  const hw = halfWidthOf('tool');
  const h = heightOf('tool');
  const [x0, y0, x1, y1] = space.navigable;
  return {
    x: Math.round(Math.min(Math.max(from[0], x0 + hw), x1 - hw)),
    y: Math.round(Math.min(Math.max(from[1], y0 + h), y1)),
    pose: 'tool',
  };
}

/**
 * 相遇：双方各走直线到动作位的两端，按同一时间轴同步采样，一次性校验两条路径与终点。
 * 谁去哪边不固定，两种分配都试，取总路程较短且合法的一种。
 */
export function planMeet(space: FloorSpace, a: Actor, b: Actor, spot: MeetSpot): MeetResult {
  const endPose: Pose = spot.kind === 'work' ? 'tool' : 'greet';
  const options: [Point, Point][] = [
    [spot.a, spot.b],
    [spot.b, spot.a],
  ];
  options.sort((p, q) => dist([a.x, a.y], p[0]) + dist([b.x, b.y], p[1]) - (dist([a.x, a.y], q[0]) + dist([b.x, b.y], q[1])));
  for (const [ta, tb] of options) {
    const nextA: Actor = { x: ta[0], y: ta[1], pose: endPose };
    const nextB: Actor = { x: tb[0], y: tb[1], pose: endPose };
    if (!isLegal(space, nextA, nextB) || !isLegal(space, nextB, nextA)) continue;
    const pa: Point = [a.x, a.y];
    const pb: Point = [b.x, b.y];
    const steps = Math.max(1, Math.ceil(Math.max(dist(pa, ta), dist(pb, tb)) / SAMPLE_STEP));
    let ok = true;
    for (let s = 0; s <= steps && ok; s++) {
      const t = s / steps;
      const pose: Pose = s === steps ? endPose : 'rest';
      const qa = lerp(pa, ta, t);
      const qb = lerp(pb, tb, t);
      const ea: Actor = { x: qa[0], y: qa[1], pose };
      const eb: Actor = { x: qb[0], y: qb[1], pose };
      ok = isLegal(space, ea, eb) && isLegal(space, eb, ea);
    }
    if (ok) return { kind: 'meet', pathA: [pa, ta], pathB: [pb, tb], nextA, nextB };
  }
  return { kind: 'wait' };
}

/** 折线的前一段：从起点起最多走 maxLen（含截断点）。前缀的每个位置都在原路径上，所以原路径合法则前缀也合法。 */
export function leadingPath(path: readonly Point[], maxLen: number): Point[] {
  const total = pathLength(path);
  if (total <= maxLen || total === 0) return [...path];
  const end = pointAlong(path, maxLen / total);
  const out: Point[] = [path[0]!];
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    walked += dist(path[i - 1]!, path[i]!);
    if (walked >= maxLen) break;
    out.push(path[i]!);
  }
  out.push(end);
  return out;
}

/**
 * 搬走：沿合法路径走向最近的楼层外缘（左右两端取近的一边，高度不变）。
 * 带着行李（tool 姿态）走时，途中与终点都按带道具的 envelope 检查；被挡就返回 wait。
 */
export function planExit(space: FloorSpace, self: Actor, other: Actor | null): MoveResult {
  const hw = halfWidthOf(self.pose);
  const [x0, , x1] = space.navigable;
  const left = x0 + hw;
  const right = x1 - hw;
  const order = Math.abs(self.x - left) <= Math.abs(right - self.x) ? [left, right] : [right, left];
  let last: MoveResult = { kind: 'wait', keep: self };
  for (const x of order) {
    last = planMove(space, self, other, { x, y: self.y, pose: self.pose });
    if (last.kind === 'move') return last;
  }
  return last;
}

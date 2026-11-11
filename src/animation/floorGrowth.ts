// 长楼动画的纯计划：只依赖两个 grownFloors 的布局差值，不读时间、不用随机数。
// 屋顶从“旧布局里它所在的位置”轻顶到新位置；新楼层模块自下而上揭开；屋顶附近冒几颗小星星。
import type { ModuleId } from '../house/assets';
import { MODULES } from '../house/data/modules';
import { layoutHouse } from '../house/layout';

/** 整段动画（顶起、揭开、星星）的总时长上限，毫秒。 */
export const FLOOR_GROWTH_MS = 900;

export interface Sparkle {
  /** 相对舞台宽/高的百分比位置（落在新屋顶附近）。 */
  leftPct: number;
  topPct: number;
  /** 飘散位移，单位为星星自身尺寸的百分比。 */
  dxPct: number;
  dyPct: number;
  delayMs: number;
  durationMs: number;
}

export interface FloorGrowthPlan {
  fromFloors: number;
  toFloors: number;
  /** 本次新长出的楼层模块（不含屋顶；屋顶一直存在，只位移）。 */
  newModules: readonly ModuleId[];
  /** 屋顶起点相对终点的偏移，单位为屋顶自身宽/高的百分比（旧位置 → 新位置）。 */
  roofFromXPct: number;
  roofFromYPct: number;
  sparkles: readonly Sparkle[];
}

/** 星星的相对分布：x 为舞台宽度比例，y 为屋顶高度比例，位移为自身尺寸百分比。固定表，保证确定性。 */
const SPARKLE_TABLE = [
  { x: 0.24, y: 0.34, dx: -70, dy: -260, delay: 0 },
  { x: 0.4, y: 0.12, dx: -30, dy: -300, delay: 60 },
  { x: 0.56, y: 0.22, dx: 40, dy: -280, delay: 30 },
  { x: 0.72, y: 0.38, dx: 90, dy: -240, delay: 100 },
] as const;

export function planFloorGrowth(fromFloors: number, toFloors: number): FloorGrowthPlan {
  const from = layoutHouse(fromFloors);
  const to = layoutHouse(toFloors);
  const had = new Set<ModuleId>(from.modules.map((m) => m.id));
  const newModules = to.modules.map((m) => m.id).filter((id) => id !== 'roof' && !had.has(id));
  const roofFrom = from.modules[from.modules.length - 1]!;
  const roofTo = to.modules[to.modules.length - 1]!;
  const roof = MODULES.roof;
  const sparkles = SPARKLE_TABLE.map((s) => ({
    leftPct: s.x * 100,
    topPct: ((roof.height * s.y) / to.stageHeight) * 100,
    dxPct: s.dx,
    dyPct: s.dy,
    delayMs: s.delay,
    durationMs: FLOOR_GROWTH_MS - s.delay,
  }));
  return {
    fromFloors,
    toFloors,
    newModules,
    roofFromXPct: ((roofFrom.dx - roofTo.dx) / roof.width) * 100,
    roofFromYPct: ((roofFrom.y - roofTo.y) / roof.height) * 100,
    sparkles,
  };
}

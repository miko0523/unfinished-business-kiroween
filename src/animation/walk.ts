// 水平漫游时“脸朝前”的纯计划：眼睛和腮红朝前进方向挪一点，身体微前倾，裙边往后飘；垂直移动不挪，停下回正。
import type { Point } from '../house/data/slots';

export type Facing = -1 | 0 | 1;

/** 身体轮廓宽度（BODY_PATH 的 x 16–124）。 */
export const BODY_WIDTH = 108;
/** 脸挪动的距离占身体宽度的比例（规格 8%–10%）。 */
export const FACE_SHIFT_RATIO = 0.09;
export const FACE_SHIFT = Math.round(BODY_WIDTH * FACE_SHIFT_RATIO * 10) / 10;
/** 身体前倾角度（度）。 */
export const LEAN_DEG = 4;

export interface FacingStep {
  /** 从位移开始算起的毫秒。 */
  atMs: number;
  facing: Facing;
}

/**
 * 沿折线按弧长换算每一段的朝向：这一段以水平位移为主（|dx| > |dy|）才朝前，否则回正。
 * 位移按弧长均匀播放（与 WAAPI 的 linear 一致）；相邻同向的段合并。
 */
export function walkSteps(path: readonly Point[], durationMs: number): FacingStep[] {
  const segs: { len: number; facing: Facing }[] = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i]![0] - path[i - 1]![0];
    const dy = path[i]![1] - path[i - 1]![1];
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    segs.push({ len, facing: Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : -1) : 0 });
    total += len;
  }
  const out: FacingStep[] = [];
  let at = 0;
  for (const s of segs) {
    if (out.length === 0 || out[out.length - 1]!.facing !== s.facing) out.push({ atMs: Math.round((at / total) * durationMs), facing: s.facing });
    at += s.len;
  }
  return out;
}

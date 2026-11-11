// 家务与橡皮擦的编排常量（纯数据）。时间轴与 src/ghost-motion.css 中的关键帧百分比一一对应：
// 改这里的时长，必须同步改样式里的 animation-duration。
// 坐标一律是 Ghost 的 viewBox（0 0 140 180，锚点 (70,180)）；道具与特效只允许出现在身体外侧的右边一栏。
import type { Chore } from '../domain/types';

/** 家务动画整套约 2 秒（规格上限 2 秒）。 */
export const CHORE_MS = 2000;
export const ERASE_MS = 1500;
export const CLARIFY_MS = 800;
/** 专注眼换成开心眼的时刻（家务总时长的 72%）。 */
export const CHORE_HAPPY_AT_MS = 1440;
/** 做家务时身体向左让出的距离，给右侧的道具留出位置。 */
export const TOOL_SHIFT = 16;
/** 家务的小星星从这一刻开始冒出（灰变星、冒芽、玻璃闪亮之后）。 */
export const CHORE_STARS_AT_MS = 1400;

export const VIEW_W = 140;
export const VIEW_H = 180;

/** [x0, y0, x1, y1]。 */
export type Box = readonly [number, number, number, number];
export type Point = readonly [number, number];

export type PlayReach = Chore | 'erase';

/**
 * 每个动作里所有道具与特效在整个动画过程中的最大活动范围（已计入摆幅与描边）。
 * 碰撞盒（带道具的 envelope，半宽 70、高 180）正好覆盖整个 viewBox，所以只要这里的盒子都在 viewBox 内，
 * 道具扩出后碰撞盒就真实涵盖它们；同时它们都在“身体右缘（让位之后）”之外，不压脸和身体。
 */
export const REACH: Readonly<Record<PlayReach, readonly Box[]>> = {
  // 扫把（放大一档，含左右各 3 的摆幅与 3° 倾角）、扬起的灰
  sweep: [[112, 50, 140, 172], [108, 150, 138, 176]],
  // 水壶（绕握把倾倒 46°）、三滴水、花盆与小芽
  water: [[104, 90, 139, 130], [130, 118, 138, 152], [119, 126, 140, 176]],
  // 小窗（含边框）、抹布画圈、亮光
  'window': [[106, 46, 138, 100], [108, 62, 136, 90]],
  // 橡皮（左擦到身体右缘、右收到 +5）、灰屑
  erase: [[104, 104, 137, 122], [108, 118, 130, 142]],
};

/** 靠道具那一侧的小手整只抬向道具时，手心应到达的握持点（Ghost 的 viewBox 坐标，按绿色 0.854 缩放估算）。 */
export const GRIP: Readonly<Record<PlayReach, Point>> = {
  sweep: [122, 110],
  water: [108, 106],
  'window': [112, 76],
  erase: [112, 113],
};

/** 擦窗时身体略飘高到窗旁（单位：viewBox）。 */
export const WINDOW_LIFT = 10;

/** 身体让位之后的右缘；道具与特效必须在它外面。 */
export function bodyRightEdge(visualScale: number): number {
  return 70 + 54 * visualScale - TOOL_SHIFT;
}

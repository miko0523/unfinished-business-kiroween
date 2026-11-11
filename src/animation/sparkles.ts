// 小星星的编排表（纯数据，确定性）：热闹放在事件上。每颗星淡入、飘散、淡出，单颗不短于 0.9 秒，不快闪。
// 坐标是 Ghost 的 viewBox（0 0 140 180）；位移 dx、dy 同样用 viewBox 单位。
export type BurstKind = 'few' | 'chore' | 'full';

export interface Spark {
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** 星星的半径。 */
  size: number;
  delayMs: number;
  durMs: number;
}

/** 一轮星星从开始到最后一颗消失的上限。 */
export const BURST_LIMIT_MS = 2000;
/** 单颗星最短的可见时长：低于它就会显得像闪烁。 */
export const SPARK_MIN_MS = 900;

export const BURSTS: Readonly<Record<BurstKind, readonly Spark[]>> = {
  // 入住落地、变白、变绿：围着身体冒几颗就收
  few: [
    { x: 26, y: 96, dx: -8, dy: -26, size: 5, delayMs: 0, durMs: 1200 },
    { x: 116, y: 80, dx: 8, dy: -28, size: 6, delayMs: 150, durMs: 1200 },
    { x: 40, y: 54, dx: -6, dy: -24, size: 4, delayMs: 300, durMs: 1100 },
    { x: 104, y: 50, dx: 6, dy: -22, size: 4, delayMs: 450, durMs: 1100 },
  ],
  // 做完一件家务：灰变星、冒芽、玻璃亮光之后，在道具那一侧冒两三颗
  chore: [
    { x: 116, y: 146, dx: -2, dy: -26, size: 5, delayMs: 0, durMs: 1000 },
    { x: 126, y: 128, dx: 4, dy: -24, size: 6.5, delayMs: 120, durMs: 1000 },
    { x: 122, y: 112, dx: -4, dy: -22, size: 4, delayMs: 260, durMs: 1000 },
  ],
  // 变金、告别：最满，围着整个身体散开
  full: [
    { x: 22, y: 100, dx: -14, dy: -26, size: 6, delayMs: 0, durMs: 1400 },
    { x: 116, y: 98, dx: 14, dy: -26, size: 6, delayMs: 60, durMs: 1400 },
    { x: 40, y: 60, dx: -12, dy: -28, size: 7, delayMs: 140, durMs: 1500 },
    { x: 104, y: 56, dx: 12, dy: -28, size: 7, delayMs: 200, durMs: 1500 },
    { x: 70, y: 44, dx: 0, dy: -26, size: 5, delayMs: 280, durMs: 1400 },
    { x: 18, y: 138, dx: -10, dy: -22, size: 4, delayMs: 360, durMs: 1300 },
    { x: 122, y: 136, dx: 10, dy: -22, size: 4.5, delayMs: 420, durMs: 1300 },
    { x: 52, y: 42, dx: -8, dy: -22, size: 4, delayMs: 500, durMs: 1300 },
    { x: 90, y: 42, dx: 8, dy: -22, size: 4.5, delayMs: 560, durMs: 1300 },
  ],
};

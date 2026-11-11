// 告别时小幽灵化成的那颗星星沿弧线飞向纪念册：纯函数，给出弧线上的若干个关键点。
export interface FlightPoint {
  /** 0–1，沿时间轴的位置。 */
  offset: number;
  /** 相对起点的位移（舞台逻辑像素）。 */
  x: number;
  y: number;
  /** 0–1，缩放系数（先稍大，飞近时变小）。 */
  scale: number;
}

/**
 * 二次贝塞尔：起点 (0,0)，终点 (dx,dy)，控制点在连线中点上方 lift 处，所以是一条向上拱起的弧。
 * 前 12% 用来“化成星星”（原地微微放大），之后沿弧线飞行。
 */
export function flightArc(dx: number, dy: number, lift: number, steps = 8): FlightPoint[] {
  const cx = dx / 2;
  const cy = dy / 2 - lift;
  const pts: FlightPoint[] = [{ offset: 0, x: 0, y: 0, scale: 1 }];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const x = 2 * (1 - u) * u * cx + u * u * dx;
    const y = 2 * (1 - u) * u * cy + u * u * dy;
    pts.push({ offset: 0.12 + 0.88 * u, x, y, scale: 1.15 - 0.85 * u });
  }
  return pts;
}

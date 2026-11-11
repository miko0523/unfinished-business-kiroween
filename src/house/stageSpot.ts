// 抽屉上沿小舞台的位置（纯函数，视口像素）：被选中的 Ghost 站在抽屉上沿正中。
// 舞台只是一个落点，不是控件：它在抽屉之上，不压住抽屉里的标题与按钮。

export interface DrawerBox {
  /** 抽屉的左边与宽度（视口像素）。 */
  left: number;
  width: number;
  /** 抽屉上沿（视口像素，用布局高度算出的最终位置，不受滑入动画影响）。 */
  top: number;
}

export interface GhostBox {
  width: number;
  height: number;
}

export interface StageSpot {
  /** Ghost 盒子的水平中心。 */
  cx: number;
  /** Ghost 盒子的底边（= 锚点，身体底边中点所在的线）。 */
  bottom: number;
  /** 舞台放得下：Ghost 的可见部分整只在视口内、在抽屉之上。放不下时回到“滚动露出”的兜底。 */
  fits: boolean;
}

/** 盒子底边比抽屉上沿高一点点；盒子底边以上还有几个像素才是裙边，所以裙边看起来正好站在边上。 */
export const STAGE_LIFT = 1;
/** Ghost 盒子顶部大约这一比例是空的（呆毛之上），不要求它也在视口内。 */
export const TOP_EMPTY_RATIO = 0.25;
/** 可见部分离视口顶部至少这么远。 */
export const STAGE_TOP_MARGIN = 6;

export function stageSpot(drawer: DrawerBox, ghost: GhostBox, viewportWidth: number): StageSpot {
  const half = ghost.width / 2;
  const cx = Math.min(Math.max(drawer.left + drawer.width / 2, half), Math.max(half, viewportWidth - half));
  const bottom = drawer.top - STAGE_LIFT;
  const visibleTop = bottom - ghost.height * (1 - TOP_EMPTY_RATIO);
  return { cx, bottom, fits: visibleTop >= STAGE_TOP_MARGIN };
}

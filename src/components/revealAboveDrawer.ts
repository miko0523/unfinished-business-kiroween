// 抽屉从底部升起后，让被选中的 Ghost 完整露在抽屉上方的可视区。
// 用抽屉的布局高度而不是它的当前 rect，所以滑入动画进行中也能一次算准。

/** Ghost 下方“x/y 步”小标签的高度余量。 */
const TAG_ROOM = 26;
const MARGIN = 8;

/** 纯计算：ghost 的上下沿、抽屉上沿、视口高度 → 最小滚动量。 */
export function scrollNeeded(ghostTop: number, ghostBottom: number, drawerTop: number): number {
  const bottomOverflow = ghostBottom + TAG_ROOM - (drawerTop - MARGIN);
  if (bottomOverflow > 0) {
    // 向下滚会把 Ghost 顶上去：不能让上沿滚出视口顶端。
    return Math.min(bottomOverflow, Math.max(0, ghostTop - MARGIN));
  }
  if (ghostTop < MARGIN) return ghostTop - MARGIN;
  return 0;
}

export function revealAboveDrawer(drawer: HTMLElement, ghost: HTMLElement | null, smooth: boolean): void {
  if (!ghost) return;
  const drawerTop = window.innerHeight - 8 - drawer.offsetHeight;
  const r = ghost.getBoundingClientRect();
  const delta = Math.round(scrollNeeded(r.top, r.bottom, drawerTop));
  if (delta === 0) return;
  window.scrollBy({ top: delta, behavior: smooth ? 'smooth' : 'auto' });
}

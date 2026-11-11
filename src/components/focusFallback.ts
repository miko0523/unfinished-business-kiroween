// 焦点兜底：打开对话框或详情卡的那个控件如果已经不在了（被移除、被隐藏），焦点不能掉进空处。
// 先试原来的控件，其次创建框，最后是页面唯一的标题（它是可程序化聚焦的）。

/** 元素还在页面里、没被隐藏、没被禁用，才算能接住焦点。 */
export function canHoldFocus(el: Element | null | undefined): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement) || !el.isConnected) return false;
  if ((el as HTMLButtonElement).disabled) return false;
  if (el.closest('[hidden], [inert]')) return false;
  return el.getClientRects().length > 0;
}

/** 创建框，否则唯一的 h1。 */
export function fallbackTarget(): HTMLElement | null {
  const create = document.getElementById('create-title');
  if (canHoldFocus(create)) return create;
  const title = document.querySelector<HTMLElement>('h1');
  return canHoldFocus(title) ? title : null;
}

/**
 * 当前这一轮渲染提交之后检查一次：焦点若落在了空处（body、已移除或不可见的元素），交给兜底目标。
 * 不抢走玩家已经移到别处的焦点。
 */
export function settleFocus(): void {
  setTimeout(() => {
    const active = document.activeElement;
    if (active && active !== document.body && canHoldFocus(active)) return;
    fallbackTarget()?.focus({ preventScroll: true });
  }, 0);
}

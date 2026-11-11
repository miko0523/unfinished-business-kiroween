// 玩家最近一次是用键盘还是指针（鼠标、触摸、笔）操作的，写在 <html data-input="keyboard|pointer"> 上。
// 用途：程序移来的“落脚点”（页面标题、详情卡标题、纪念册标题）只在键盘操作时才画焦点轮廓。
// 刚打开页面、或用指针点进来时，浏览器会把脚本聚焦也算成 :focus-visible，标题周围就会留下一圈粗框。
// 可操作的控件不受影响，它们仍然沿用浏览器自己的 :focus-visible。

export type InputModality = 'keyboard' | 'pointer';

/** 开始跟踪；返回取消函数。重复调用安全（每次独立挂钩、独立撤销）。 */
export function installInputModality(root: HTMLElement = document.documentElement): () => void {
  const set = (mode: InputModality) => {
    if (root.dataset.input !== mode) root.dataset.input = mode;
  };
  const onKey = () => set('keyboard');
  const onPointer = () => set('pointer');
  // 捕获阶段：先于任何会移动焦点的处理器。
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onPointer, true);
  document.addEventListener('mousedown', onPointer, true);
  document.addEventListener('touchstart', onPointer, true);
  return () => {
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onPointer, true);
    document.removeEventListener('mousedown', onPointer, true);
    document.removeEventListener('touchstart', onPointer, true);
    delete root.dataset.input;
  };
}

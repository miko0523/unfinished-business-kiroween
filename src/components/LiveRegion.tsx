import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useReducedMotion } from './useReducedMotion';

export interface LiveRegionProps {
  message: string;
}

/** 减少动态时，文字替代在画面上停留多久。 */
export const CAPTION_MS = 6000;

/**
 * 读屏播报区（role="status"，礼貌播报）：完整保留状态变化、取消勾选、等你确认、暖灯点亮与告别完成。
 * 系统开启“减少动态”时，没有漂浮、粒子、飞行可看，这句话同时作为静态文字提示显示在画面顶部一小会儿；
 * 同一个元素，只改显示方式，读屏看到的文字不变。
 */
export function LiveRegion({ message }: LiveRegionProps) {
  const reduced = useReducedMotion();
  const [showing, setShowing] = useState(false);
  useEffect(() => {
    if (!message) {
      setShowing(false);
      return;
    }
    setShowing(true);
    const timer = setTimeout(() => setShowing(false), CAPTION_MS);
    return () => clearTimeout(timer);
  }, [message]);
  const caption = reduced && showing && message !== '';
  const box = useRef<HTMLParagraphElement>(null);
  // 提示固定在画面底部时，键盘把焦点移到它下面的控件，浏览器不知道那里被盖着：把提示的高度告诉样式，
  // 让焦点滚动时留出这块地方（html 的 scroll-padding-bottom），聚焦的控件不会被提示遮住。
  useLayoutEffect(() => {
    const root = document.documentElement.style;
    if (caption && box.current) root.setProperty('--caption-h', `${box.current.offsetHeight}px`);
    else root.removeProperty('--caption-h');
    return () => root.removeProperty('--caption-h');
  }, [caption, message]);
  return (
    <p ref={box} class={caption ? 'live-region live-caption' : 'live-region visually-hidden'} role="status" aria-live="polite" data-caption={caption ? 'true' : 'false'}>
      {message}
    </p>
  );
}

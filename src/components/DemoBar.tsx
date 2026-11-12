import { useEffect, useRef } from 'preact/hooks';
import { useDemoControl } from '../demo/control';
import { useCopy } from './useCopy';

/** 示例期间固定在顶部的提示条与退出入口。 */
export function DemoBar() {
  const t = useCopy();
  const demo = useDemoControl();
  const exit = useRef<HTMLButtonElement>(null);
  const bar = useRef<HTMLElement>(null);
  useEffect(() => exit.current?.focus({ preventScroll: true }), []);
  // 减少动态时的文字提示要躲开这条提示条：把它的高度告诉样式。
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const root = document.documentElement;
    const sync = () => root.style.setProperty('--demo-bar-h', `${el.offsetHeight}px`);
    sync();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(sync) : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.style.removeProperty('--demo-bar-h');
    };
  }, []);
  return (
    <section class="demo-bar" ref={bar} aria-label={t('demo.region')}>
      <p class="demo-note">{t('demo.notice')}</p>
      <button type="button" class="demo-exit" ref={exit} onClick={demo.exit}>
        {t('demo.exit')}
      </button>
    </section>
  );
}

/** “Try sample”入口（页头的星星图标）；从示例退出回来时，焦点回到这里。 */
export function TrySample() {
  const t = useCopy();
  const demo = useDemoControl();
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (demo.returning()) button.current?.focus({ preventScroll: true });
  }, []);
  return (
    <button
      type="button"
      class="header-icon demo-try"
      ref={button}
      aria-label={t('demo.try')}
      title={t('demo.try')}
      onClick={demo.enter}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
        <path
          d="M12 3.5c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7z"
          fill="currentColor"
          stroke="currentColor"
          stroke-width="1.2"
          stroke-linejoin="round"
        />
        <path d="M18.5 15.5v4M16.5 17.5h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
      </svg>
    </button>
  );
}

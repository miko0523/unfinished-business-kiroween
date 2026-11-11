import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { StaticLayer } from './StaticLayer';
import { useFloorGrowth, type ActiveGrowth } from './useFloorGrowth';
import { usePreloadFloors } from './usePreloadFloors';
import { useViewLayout } from './useViewLayout';
import { layoutHouse, type GrownFloors } from '../house/layout';
import { STAGE_WIDTH } from '../house/stage';
import { FLOOR_GROWTH_MS } from '../animation/floorGrowth';

export interface HouseProps {
  grownFloors: GrownFloors;
  /** 叠在静态层之上的动态层（阶段 4 起接入）。 */
  children?: ComponentChildren;
}

/** 旧宅舞台：居中、按视口等比缩放。静态层只拿到 grownFloors。 */
export function House({ grownFloors, children }: HouseProps) {
  const { stageHeight } = layoutHouse(grownFloors);
  const growth = useFloorGrowth(grownFloors);
  const view = useViewLayout(grownFloors);
  const preload = usePreloadFloors(grownFloors);
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!growth || !root.current) return;
    return playGrowth(root.current, growth);
  }, [growth]);
  return (
    <div
      ref={root}
      class="house"
      data-grown-floors={grownFloors}
      data-growing={growth ? 'true' : undefined}
      data-floor-preload={preload}
      data-camera={view.panorama ? 'panorama' : 'focus'}
      style={{ aspectRatio: `${STAGE_WIDTH} / ${stageHeight}`, maxWidth: `${STAGE_WIDTH}px`, ...(view.widthPx !== null ? { width: `${view.widthPx}px` } : {}) }}
    >
      <StaticLayer grownFloors={grownFloors} />
      {growth ? (
        <div class="grow-sparkles" aria-hidden="true">
          {growth.sparkles.map((s, i) => (
            <span key={`${growth.runId}-${i}`} class="grow-sparkle" style={{ left: `${s.leftPct}%`, top: `${s.topPct}%` }} />
          ))}
        </div>
      ) : null}
      {children ? <div class="house-overlay">{children}</div> : null}
    </div>
  );
}

/**
 * 在刚提交的 DOM 上起动画（绘制之前）：屋顶从旧位置轻顶到新位置，新楼层透明度 + clip-path 自下而上揭开，星星淡入淡出并飘散。
 * 全部用 Web Animations：不写任何 class 或内联样式，取消即回到由 grownFloors 决定的稳态。返回清理函数。
 */
function playGrowth(root: HTMLElement, g: ActiveGrowth): () => void {
  const running: Animation[] = [];
  const start = (el: Element | null, keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
    if (!el || typeof el.animate !== 'function') return;
    try {
      const a = el.animate(keyframes, options);
      a.finished?.catch(() => {}); // 取消时 finished 会被拒绝，这是正常的
      running.push(a);
    } catch {
      /* 动画不可用：稳态由数据决定 */
    }
  };
  const mod = (id: string) => root.querySelector(`.static-layer [data-module="${id}"]`);

  start(
    mod('roof'),
    [{ transform: `translate(${g.roofFromXPct}%, ${g.roofFromYPct}%)` }, { transform: 'translate(0%, 0%)' }],
    { duration: FLOOR_GROWTH_MS, easing: 'cubic-bezier(0.22, 0.8, 0.3, 1)', fill: 'backwards' },
  );
  for (const id of g.newModules) {
    start(
      mod(id),
      [
        { opacity: 0, clipPath: 'inset(100% 0 0 0)' },
        { opacity: 1, clipPath: 'inset(0% 0 0 0)' },
      ],
      { duration: FLOOR_GROWTH_MS, easing: 'ease-out', fill: 'backwards' },
    );
  }
  const stars = root.querySelectorAll('.grow-sparkle');
  g.sparkles.forEach((s, i) => {
    start(
      stars[i] ?? null,
      [
        { opacity: 0, transform: 'translate(0%, 0%) scale(0.5)' },
        { opacity: 1, transform: `translate(${s.dxPct * 0.35}%, ${s.dyPct * 0.35}%) scale(1)`, offset: 0.3 },
        { opacity: 0, transform: `translate(${s.dxPct}%, ${s.dyPct}%) scale(0.8)` },
      ],
      { duration: s.durationMs, delay: s.delayMs, easing: 'ease-out', fill: 'both' },
    );
  });
  return () => {
    for (const a of running) {
      try {
        a.cancel();
      } catch {
        /* 已经结束 */
      }
    }
    running.length = 0;
  };
}

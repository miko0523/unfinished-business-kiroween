import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import { FLOOR_GROWTH_MS, planFloorGrowth, type FloorGrowthPlan } from '../animation/floorGrowth';
import { StoreContext } from '../store/StoreContext';
import { prefersReducedMotion } from './useReducedMotion';

export interface ActiveGrowth extends FloorGrowthPlan {
  /** 每次新事件递增，用来让上一轮的星星与动画整体换新。 */
  runId: number;
}

function pageHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden === true;
}

/**
 * 长楼动画的触发器：只消费 FloorGrown 事件，不读也不改 domain 状态。
 * 返回值只在动画进行中非空（≤ FLOOR_GROWTH_MS）；稳态完全由 grownFloors 决定。
 * 减少动态、页面隐藏、新事件、卸载，都会立刻收口。没有 StoreContext（如校准页）时什么也不做。
 */
export function useFloorGrowth(grownFloors: number): ActiveGrowth | null {
  const ctx = useContext(StoreContext);
  const store = ctx?.store ?? null;
  const [growth, setGrowth] = useState<ActiveGrowth | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const run = useRef(0);
  // 事件在重渲染之前到达，此刻 ref 里还是增长前的层数。
  const floors = useRef(grownFloors);
  floors.current = grownFloors;

  useEffect(() => {
    const stop = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      setGrowth(null);
    };
    const off = store
      ? store.subscribeEvents((events) => {
          for (const e of events) {
            if (e.type !== 'FloorGrown') continue;
            stop(); // 旧动画先收口，新动画从当前稳态开始
            if (prefersReducedMotion() || pageHidden()) continue;
            const to = e.floor;
            const from = floors.current < to ? floors.current : to - 1;
            if (from < 2) continue;
            setGrowth({ ...planFloorGrowth(from, to), runId: ++run.current });
            timer.current = setTimeout(stop, FLOOR_GROWTH_MS);
          }
        })
      : () => {};
    const onVisibility = () => {
      if (pageHidden()) stop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    const onMotion = () => {
      if (mq?.matches) stop();
    };
    mq?.addEventListener('change', onMotion);
    return () => {
      off();
      document.removeEventListener('visibilitychange', onVisibility);
      mq?.removeEventListener('change', onMotion);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [store]);

  return growth;
}

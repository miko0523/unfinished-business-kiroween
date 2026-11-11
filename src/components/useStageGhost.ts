import { useEffect, useRef } from 'preact/hooks';
import { stageSpot } from '../house/stageSpot';
import { STAGE_WIDTH } from '../house/stage';
import { stageBusOf } from '../store/stageBus';
import type { AppContext } from '../store/StoreContext';
import { createStageFlights } from './stageFlight';

const hidden = () => typeof document !== 'undefined' && document.hidden === true;

/**
 * 抽屉上沿的小舞台：被选中的 Ghost 本体从屋里飞到抽屉上沿正中，关闭或改选时沿原路飞回。
 * 始终只有这一个 DOM 元素（语义列表、焦点和点击目标都不变），屋里不留第二只。
 * 舞台放不下（视口太矮）时什么都不做，由抽屉里的“滚动露出”兜底。
 *
 * lis：任务 id → 它在动态层里的列表项（漫游的位置作用在它上面）；Ghost 按钮是它的第一个子元素。
 */
export function useStageGhost(ctx: AppContext, selectedId: string | null, lis: { current: Map<string, HTMLElement> }, reduced: boolean): void {
  const flights = useRef(createStageFlights());
  const staged = useRef(new Set<string>());
  const selected = useRef(selectedId);
  selected.current = selectedId;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const bus = stageBusOf(ctx);

  const buttonOf = (id: string): HTMLElement | null => (lis.current.get(id)?.querySelector('.ghost-button') as HTMLElement | null) ?? null;

  const sync = () => {
    const f = flights.current;
    const animate = !reducedRef.current && !hidden();
    // 减少动态：正在进行的飞行（来或回）立刻落定，不再滑行。
    if (!animate) f.settleAll();
    const drawer = bus.get();
    const id = selected.current;
    let want: { id: string; dx: number; dy: number } | null = null;
    const li = id ? lis.current.get(id) : undefined;
    if (id && li && drawer) {
      // li 带着漫游的位置，但不含按钮自己的位移：按钮此刻的位置 = li 的位置 + 按钮的位移。
      const r = li.getBoundingClientRect();
      const spot = stageSpot(drawer, { width: r.width, height: r.height }, window.innerWidth);
      if (spot.fits) want = { id, dx: spot.cx - (r.left + r.width / 2), dy: spot.bottom - r.bottom };
    }
    for (const old of [...staged.current]) {
      const el = lis.current.get(old);
      const btn = buttonOf(old);
      if (old === want?.id) continue;
      staged.current.delete(old);
      if (!el || !btn) continue;
      f.back(btn, animate, () => el.removeAttribute('data-staged'));
    }
    if (want) {
      const btn = buttonOf(want.id);
      if (btn) {
        staged.current.add(want.id);
        lis.current.get(want.id)!.setAttribute('data-staged', 'true');
        f.to(btn, want.dx, want.dy, animate);
      }
    }
  };
  const syncRef = useRef(sync);
  syncRef.current = sync;

  // 系统“减少动态”随时打开：在媒体查询变化的当下就让正在飞的 Ghost 落定，不等下一次渲染。
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => {
      if (mq.matches) flights.current.settleAll();
    };
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // 选中变化：必须排在调度器的“选中即停下”之后（同一组件里 useRoamer 先于本钩子）。
  useEffect(() => syncRef.current(), [selectedId, reduced, bus]);

  useEffect(() => {
    const again = () => syncRef.current();
    const offBus = bus.subscribe(again);
    const onScroll = () => staged.current.size > 0 && syncRef.current();
    const onVisibility = () => {
      if (document.hidden) flights.current.finishAll();
      else syncRef.current();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', again);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      offBus();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', again);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [bus]);

  // 住客增减：已经被移走的元素不能留在舞台记录里；留下来的元素换了新节点时重新就位。
  useEffect(() => {
    for (const id of [...staged.current]) {
      if (lis.current.has(id) && lis.current.get(id)!.isConnected) continue;
      staged.current.delete(id);
    }
    syncRef.current();
  });

  // 庆祝从舞台上的实际位置起飞。
  useEffect(() => {
    const previous = ctx.roam.stagePointOf;
    ctx.roam.stagePointOf = (id) => {
      const li = lis.current.get(id);
      const btn = buttonOf(id);
      const root = li?.closest('.house') as HTMLElement | null;
      if (!li || !btn || !root || !flights.current.isStaged(btn)) return null;
      const house = root.getBoundingClientRect();
      const b = btn.getBoundingClientRect();
      const k = house.width / STAGE_WIDTH || 1;
      const vx = b.left + b.width / 2;
      const vy = b.bottom;
      return { logical: [(vx - house.left) / k, (vy - house.top) / k], viewport: [vx, vy] };
    };
    return () => {
      ctx.roam.stagePointOf = previous;
      flights.current.clearAll();
      for (const el of lis.current.values()) el.removeAttribute('data-staged');
      staged.current.clear();
    };
  }, [ctx]);
}

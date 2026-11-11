import { useEffect, useRef, useState } from 'preact/hooks';
import { CHORE_HAPPY_AT_MS, CHORE_MS, CHORE_STARS_AT_MS, CLARIFY_MS, ERASE_MS } from '../animation/choreography';
import { BURST_LIMIT_MS } from '../animation/sparkles';
import type { Chore } from '../domain/types';
import type { Expression, PropKind } from '../house/ghostShape';
import type { Store } from '../store/store';
import type { Burst } from './GhostFx';
import { prefersReducedMotion } from './useReducedMotion';

export { CHORE_MS, CLARIFY_MS, ERASE_MS };

export type PlayKind = Chore | 'erase' | 'clarify';

export interface GhostPlay {
  /** 正在播放的动作；播完为 null。 */
  kind: PlayKind | null;
  /** 第几次播放（用作 key，让同一动作能重新开始）。 */
  n: number;
  /** 累计播放过的家务次数（只数家务，E2E 用它核对“恰好一次”）。 */
  choreTotal: number;
  expression: Expression;
  prop: PropKind;
  /** 正在冒的小星星（独立于动作：动作收尾后星星还在淡出）。 */
  burst: Burst | null;
}

const PROP: Record<Chore, PropKind> = { sweep: 'broom', water: 'can', window: 'cloth' };
/** 入住动画（1.2 秒）落地之后才冒星星。 */
const MOVE_IN_STARS_AT_MS = 1100;
/** 变绿的星星等家务的星星散完（约 0.4 秒）再冒，两轮不叠在一起。 */
const GREEN_STARS_GAP_MS = 700;

export type RunChore = (taskId: string, durMs: number, ready: (ok: boolean) => void) => void;

const IDLE: GhostPlay = { kind: null, n: 0, choreTotal: 0, expression: 'shy', prop: 'none', burst: null };

/**
 * 把动画事件翻译成每只 Ghost 的“正在做什么”。新动作先取消旧动作的收尾计时与迟到的星星，立刻接管；
 * 播完后回到稳态（颜色由数据决定，这里只管动作、道具、表情与星星）。
 * 页面隐藏时全部取消；减少动态下不冒星星，表情照常切换。
 */
export function useGhostPlays(store: Store, runChore: RunChore): ReadonlyMap<string, GhostPlay> {
  const [plays, setPlays] = useState<ReadonlyMap<string, GhostPlay>>(() => new Map());
  const timers = useRef(new Map<string, unknown[]>());
  const gens = useRef(new Map<string, number>());
  /** 刚变绿、等这次家务演完再冒星星的 Ghost。 */
  const greening = useRef(new Set<string>());
  const runRef = useRef(runChore);
  runRef.current = runChore;

  useEffect(() => {
    // 每个 task 的动作代数：任何新动作都使旧的异步回调（家务就绪、迟到的星星、收尾计时）作废。
    const bump = (id: string) => {
      const n = (gens.current.get(id) ?? 0) + 1;
      gens.current.set(id, n);
      return n;
    };
    const clear = (id: string) => {
      for (const h of timers.current.get(id) ?? []) clearTimeout(h as number);
      timers.current.delete(id);
    };
    const later = (id: string, gen: number, ms: number, fn: () => void) => {
      const h = setTimeout(() => {
        if (gens.current.get(id) === gen) fn();
      }, ms);
      const list = timers.current.get(id) ?? [];
      list.push(h);
      timers.current.set(id, list);
    };
    const patch = (id: string, f: (p: GhostPlay) => GhostPlay) => setPlays((prev) => new Map(prev).set(id, f(prev.get(id) ?? IDLE)));
    const burst = (id: string, kind: Burst['kind']) => {
      if (prefersReducedMotion()) return;
      let current: Burst;
      patch(id, (p) => {
        current = { kind, n: (p.burst?.n ?? 0) + 1 };
        return { ...p, burst: current };
      });
      later(id, gens.current.get(id)!, BURST_LIMIT_MS, () => {
        patch(id, (p) => p.burst === current ? { ...p, burst: null } : p);
      });
    };
    const start = (id: string, gen: number, kind: PlayKind, ms: number, expression: Expression, prop: PropKind, laterExpression?: [number, Expression]) => {
      clear(id);
      patch(id, (p) => ({
        ...p,
        kind,
        n: p.n + 1,
        choreTotal: p.choreTotal + (kind === 'erase' || kind === 'clarify' ? 0 : 1),
        expression,
        prop,
        burst: null,
      }));
      if (laterExpression) later(id, gen, laterExpression[0], () => patch(id, (p) => ({ ...p, expression: laterExpression[1] })));
      if (kind !== 'erase' && kind !== 'clarify') {
        later(id, gen, CHORE_STARS_AT_MS, () => burst(id, 'chore'));
        if (greening.current.delete(id)) later(id, gen, ms + GREEN_STARS_GAP_MS, () => burst(id, 'few'));
      }
      later(id, gen, ms, () => {
        timers.current.delete(id);
        patch(id, (p) => ({ ...p, kind: null, expression: 'shy', prop: 'none' }));
      });
    };

    const off = store.subscribeEvents((events) => {
      if (typeof document !== 'undefined' && document.hidden) return;
      // 变绿：这一批里 StepChecked 排在 StateChanged 之前，先登记，家务开始时才知道要接一轮星星。
      for (const e of events) if (e.type === 'StateChanged' && e.to === 'green' && e.from !== 'green') greening.current.add(e.taskId);
      for (const e of events) {
        if (e.type === 'StepChecked') {
          // 先确认带道具的姿态在这间房里合法；等太久就略过动作，只保留颜色与文字。
          const gen = bump(e.taskId);
          runRef.current(e.taskId, CHORE_MS, (ok) => {
            if (gens.current.get(e.taskId) !== gen) return;
            if (ok) start(e.taskId, gen, e.chore, CHORE_MS, 'focused', PROP[e.chore], [CHORE_HAPPY_AT_MS, 'happy']);
            else if (greening.current.delete(e.taskId)) burst(e.taskId, 'few'); // 略过了动作：颜色变了，星星照冒
          });
        } else if (e.type === 'EraserScribble') {
          const gen = bump(e.taskId);
          greening.current.delete(e.taskId);
          start(e.taskId, gen, 'erase', ERASE_MS, 'puzzled', 'eraser', [1000, 'relieved']);
        } else if (e.type === 'ClarifiedTransition') {
          const gen = bump(e.taskId);
          start(e.taskId, gen, 'clarify', CLARIFY_MS, 'surprised', 'none');
          later(e.taskId, gen, CLARIFY_MS / 2, () => burst(e.taskId, 'few'));
        } else if (e.type === 'GhostMovedIn') {
          const gen = bump(e.taskId);
          later(e.taskId, gen, MOVE_IN_STARS_AT_MS, () => burst(e.taskId, 'few'));
        }
      }
    });
    // 页面隐藏：装饰动态整体暂停，所有进行中的动作与星星都收口。
    const onVisibility = () => {
      if (!document.hidden) return;
      greening.current.clear();
      for (const id of [...gens.current.keys()]) {
        bump(id);
        clear(id);
      }
      setPlays((prev) => {
        if (prev.size === 0) return prev;
        const next = new Map<string, GhostPlay>();
        for (const [id, p] of prev) next.set(id, { ...p, kind: null, expression: 'shy', prop: 'none', burst: null });
        return next;
      });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      off();
      document.removeEventListener('visibilitychange', onVisibility);
      for (const id of [...gens.current.keys()]) gens.current.set(id, (gens.current.get(id) ?? 0) + 1);
      for (const id of [...timers.current.keys()]) clear(id);
    };
  }, [store]);

  return plays;
}

import { useMemo, useRef, useState } from 'preact/hooks';
import { walkSteps, type Facing } from '../animation/walk';
import type { Point } from '../house/data/slots';

export interface WalkFacing {
  /** 开始一段位移：按每段折线的方向安排朝向；新的一段先取消旧的计划。 */
  begin(id: string, offsets: readonly Point[], durationMs: number): void;
  /** 停下：取消计划并回正。 */
  stop(id: string): void;
  reset(): void;
}

/**
 * 水平漫游时脸朝前：把调度器给的折线位移翻译成朝向时间表（只看水平为主的段）。
 * 返回的 facing 对象引用稳定。只记录“朝向”，怎么挪脸、前倾、飘裙边由样式完成；调用方保证减少动态与隐藏页面时不会调用 begin。
 */
export function useWalkFacing(): { walks: ReadonlyMap<string, Facing>; facing: WalkFacing } {
  const [walks, setWalks] = useState<ReadonlyMap<string, Facing>>(() => new Map());
  const timers = useRef(new Map<string, unknown[]>());
  const facing = useMemo<WalkFacing>(() => {
    const set = (id: string, f: Facing) =>
      setWalks((prev) => ((prev.get(id) ?? 0) === f ? prev : new Map(prev).set(id, f)));
    const cancel = (id: string) => {
      for (const h of timers.current.get(id) ?? []) clearTimeout(h as number);
      timers.current.delete(id);
    };
    return {
      begin(id, offsets, durationMs) {
        cancel(id);
        const hs: unknown[] = [];
        for (const step of walkSteps(offsets, durationMs)) {
          if (step.atMs <= 0) set(id, step.facing);
          else hs.push(setTimeout(() => set(id, step.facing), step.atMs));
        }
        timers.current.set(id, hs);
      },
      stop(id) {
        cancel(id);
        set(id, 0);
      },
      reset() {
        for (const id of [...timers.current.keys()]) cancel(id);
        setWalks(new Map());
      },
    };
  }, []);
  return { walks, facing };
}

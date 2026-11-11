// 抽屉把自己的位置告诉小舞台：抽屉在 TaskCard 里，被选中的 Ghost 在 ResidentLayer 里，两者之间只传这一个小对象。
// 按 AppContext 各开一份（示例与真实各自独立），不放在模块级全局里。
import type { DrawerBox } from '../house/stageSpot';

export interface StageBus {
  get(): DrawerBox | null;
  set(box: DrawerBox | null): void;
  subscribe(fn: () => void): () => void;
}

export function createStageBus(): StageBus {
  let box: DrawerBox | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => box,
    set(next) {
      const same = box && next && box.left === next.left && box.width === next.width && box.top === next.top;
      if (same || (box === null && next === null)) return;
      box = next;
      for (const l of [...listeners]) l();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
}

const buses = new WeakMap<object, StageBus>();

/** 每个上下文一条总线，按需创建。 */
export function stageBusOf(ctx: object): StageBus {
  let bus = buses.get(ctx);
  if (!bus) buses.set(ctx, (bus = createStageBus()));
  return bus;
}

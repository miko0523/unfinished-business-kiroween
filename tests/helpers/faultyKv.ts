// 可注入故障的键值存储：记录每一次写入尝试（含失败的），并按键决定写入抛错或读回走样。
import { createMemoryKv, type KeyValueStore } from '../../src/persistence/storage';

export interface Faults {
  /** 返回 true 则该次写入抛错（值不落地）。 */
  setThrows?(key: string, value: string, nth: number): boolean;
  /** 改变读回结果：返回 'throw' 抛错，返回字符串/null 则以它为读回值，返回 undefined 则照常。 */
  getAs?(key: string, real: string | null): string | null | 'throw' | undefined;
}

export interface FaultyKv extends KeyValueStore {
  /** 所有写入尝试，按时间顺序（含抛错的）。 */
  readonly attempts: { key: string; value: string; threw: boolean }[];
  /** 真实内容（不经过 getAs）。 */
  peek(key: string): string | null;
  faults: Faults;
}

export function faultyKv(initial: Record<string, string> = {}, faults: Faults = {}): FaultyKv {
  const inner = createMemoryKv(initial);
  const attempts: FaultyKv['attempts'] = [];
  const counts = new Map<string, number>();
  const kv: FaultyKv = {
    attempts,
    faults,
    peek: (key) => inner.getItem(key),
    keys: () => inner.keys(),
    getItem(key) {
      const real = inner.getItem(key);
      const forced = kv.faults.getAs?.(key, real);
      if (forced === 'throw') throw new Error('read failed');
      return forced === undefined ? real : forced;
    },
    setItem(key, value) {
      const nth = (counts.get(key) ?? 0) + 1;
      counts.set(key, nth);
      const threw = kv.faults.setThrows?.(key, value, nth) ?? false;
      attempts.push({ key, value, threw });
      if (threw) throw new Error('quota exceeded');
      inner.setItem(key, value);
    },
  };
  return kv;
}

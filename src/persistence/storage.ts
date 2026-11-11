// 键值存储的最小接口，以及 localStorage 包装与内存实现（测试用，记录写入时序）。
export interface KeyValueStore {
  /** 读不到返回 null；存储不可用时抛出。 */
  getItem(key: string): string | null;
  /** 写入失败（例如配额已满）时抛出。 */
  setItem(key: string, value: string): void;
  /** 只列出键名，不读内容。 */
  keys(): string[];
}

/** 浏览器 Storage 的结构子集。 */
export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function createLocalKv(storage: StorageLike): KeyValueStore {
  return {
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => storage.setItem(key, value),
    keys() {
      const out: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k !== null) out.push(k);
      }
      return out;
    },
  };
}

export interface MemoryKv extends KeyValueStore {
  /** 每次成功写入的 [键, 值]，按时间顺序。 */
  readonly writes: readonly (readonly [string, string])[];
  /** 之后的写入一律抛错（模拟存储写满），直到传入 false。 */
  failWrites(on: boolean): void;
  /** 之后的读取一律抛错（模拟存储不可用），直到传入 false。 */
  failReads(on: boolean): void;
}

export function createMemoryKv(initial: Readonly<Record<string, string>> = {}): MemoryKv {
  const data = new Map(Object.entries(initial));
  const writes: (readonly [string, string])[] = [];
  let writesFail = false;
  let readsFail = false;
  return {
    writes,
    failWrites(on) {
      writesFail = on;
    },
    failReads(on) {
      readsFail = on;
    },
    getItem(key) {
      if (readsFail) throw new Error('storage unavailable');
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      if (writesFail) throw new Error('quota exceeded');
      data.set(key, value);
      writes.push([key, value]);
    },
    keys: () => [...data.keys()],
  };
}

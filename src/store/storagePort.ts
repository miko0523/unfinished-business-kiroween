// 确认完成用的同步写入端口：write 写入完整文本，readBack 立刻读回。阶段 6 再接入 localStorage。
export interface StoragePort {
  /** 写入失败时抛出。 */
  write(text: string): void;
  /** 读回最近写入的文本；读不到返回 null，读取失败时抛出。 */
  readBack(): string | null;
}

export type InjectedFailure = 'write-throws' | 'readback-throws' | 'readback-null' | 'readback-differs';

export interface MemoryPort extends StoragePort {
  /** 写入时序记录（测试用）。 */
  readonly writes: readonly string[];
  /** 让之后的写入/读回按指定方式失败，直到传入 null 恢复正常。 */
  failWith(mode: InjectedFailure | null): void;
}

export function createMemoryPort(): MemoryPort {
  let stored: string | null = null;
  const writes: string[] = [];
  let mode: InjectedFailure | null = null;
  return {
    writes,
    failWith(next) {
      mode = next;
    },
    write(text) {
      if (mode === 'write-throws') throw new Error('write failed');
      writes.push(text);
      stored = text;
    },
    readBack() {
      if (mode === 'readback-throws') throw new Error('read failed');
      if (mode === 'readback-null') return null;
      if (mode === 'readback-differs') return stored === null ? 'x' : `${stored} `;
      return stored;
    },
  };
}

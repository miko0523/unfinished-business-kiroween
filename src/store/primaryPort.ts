// 主存档的端口：把 write/readBack 接到键值存储上。
// 上锁（恢复界面或内存模式）或没有存储时，写入是空操作，只在内存里留一份影子，
// 这样“确认完成”的写入加回读校验在内存模式下仍然成立，而主键一个字节都不会被碰。
import { PRIMARY_KEY } from '../persistence/keys';
import type { KeyValueStore } from '../persistence/storage';
import type { StoragePort } from './storagePort';

export interface PrimaryPort extends StoragePort {
  lock(): void;
  unlock(): void;
  isLocked(): boolean;
}

export function createPrimaryPort(kv: KeyValueStore | null, startLocked = false): PrimaryPort {
  let locked = startLocked || kv === null;
  let shadow: string | null = null;
  return {
    lock() {
      locked = true;
    },
    unlock() {
      if (kv) locked = false;
    },
    isLocked: () => locked,
    write(text) {
      if (locked || !kv) {
        shadow = text;
        return;
      }
      kv.setItem(PRIMARY_KEY, text);
    },
    readBack() {
      if (locked || !kv) return shadow;
      return kv.getItem(PRIMARY_KEY);
    },
  };
}

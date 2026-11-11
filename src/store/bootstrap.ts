// 启动：只读存储，决定初始数据与会话方式，再建 store。启动阶段不写任何键。
import { loadSave } from '../persistence/load';
import { backupAndStartFresh } from '../persistence/recovery';
import { createLocalKv, type KeyValueStore, type StorageLike } from '../persistence/storage';
import { browserEnv } from './env';
import { createPrimaryPort } from './primaryPort';
import { createStore, type SaveClock, type Store } from './store';
import type { Env } from '../domain/types';

export interface PersistentStoreOptions {
  /** 浏览器存储；null 表示不可用。 */
  storage: StorageLike | null;
  env?: Env;
  clock?: SaveClock;
}

function createRecoveryStore(kv: KeyValueStore, raw: string, env: Env, clock: SaveClock | undefined): Store {
  const port = createPrimaryPort(kv, true);
  return createStore({
    env,
    port,
    autosave: true,
    clock,
    session: { mode: 'recovery', raw },
    recovery: { startFresh: (original, fresh) => backupAndStartFresh(kv, original, fresh), unlock: () => port.unlock() },
  });
}

export function createPersistentStore({ storage, env = browserEnv(), clock }: PersistentStoreOptions): Store {
  let kv: KeyValueStore | null = null;
  try {
    kv = storage ? createLocalKv(storage) : null;
  } catch {
    kv = null;
  }
  const outcome = loadSave(kv);
  switch (outcome.kind) {
    case 'loaded':
    case 'fresh':
      return createStore({ env, initial: outcome.data, port: createPrimaryPort(kv), autosave: true, clock });
    case 'recovery':
      // 原文只保留在会话里，主键上锁，直到玩家在恢复界面主动选择。
      return createRecoveryStore(kv!, outcome.raw, env, clock);
    case 'unavailable':
      return createStore({
        env,
        port: createPrimaryPort(null),
        autosave: true,
        clock,
        session: { mode: 'memory', storage: 'unavailable' },
      });
  }
}

import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import { createStore, type Store } from './store';
import { createUiStore, type UiStore } from './uiStore';
import type { Point } from '../house/data/slots';
import { browserEnv } from './env';
import { getBrowserStorage } from './browserStorage';
import { createPersistentStore } from './bootstrap';

/** 动态层把“某只 Ghost 此刻在舞台上的位置”借给庆祝层（飞行从它当下的位置出发）。 */
export interface RoamLookup {
  /** 舞台逻辑像素中的锚点；不存在时为 null。 */
  positionOf(taskId: string): Point | null;
  /**
   * 被选中的 Ghost 站在抽屉上沿的小舞台上时，它此刻的位置：舞台逻辑像素（锚点）与视口像素。
   * 不在舞台上时返回 null。确认完成的庆祝从这里起飞。
   */
  stagePointOf?(taskId: string): { logical: Point; viewport: Point } | null;
}

export interface AppContext {
  store: Store;
  ui: UiStore;
  roam: RoamLookup;
}

export function createAppContext(): AppContext {
  return { store: createStore({ env: browserEnv() }), ui: createUiStore(), roam: { positionOf: () => null } };
}

/** 真实页面用：从浏览器本地存储读起（只读），变更后防抖保存。 */
export function createBrowserAppContext(): AppContext {
  return {
    store: createPersistentStore({ storage: getBrowserStorage(), env: browserEnv() }),
    ui: createUiStore(),
    roam: { positionOf: () => null },
  };
}

export const StoreContext = createContext<AppContext | null>(null);

export function useAppContext(): AppContext {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('StoreContext is missing');
  return ctx;
}

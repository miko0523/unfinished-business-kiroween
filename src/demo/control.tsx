// 示例的外壳控制：进入时暂停真实的 store，另建一套独立的内存 store 与 ui；退出时丢掉示例，原样回来。
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import { browserEnv } from '../store/env';
import { createStore } from '../store/store';
import { createUiStore } from '../store/uiStore';
import type { AppContext } from '../store/StoreContext';
import type { Env } from '../domain/types';
import { createSampleState } from './sample';
import type { CopyKey } from '../i18n/copy';

export interface DemoControl {
  /** 当前是否在示例里。 */
  active: boolean;
  enter(): void;
  exit(): void;
  /** 刚从示例回来、焦点还要交给“Try sample”的这一刻为 true（详情抽屉此时不抢焦点）。 */
  returning(): boolean;
  /** 界面树挂好之后，结束“刚回来”的状态。 */
  endReturn(): void;
  /** 取走进出示例时要读给读屏的一句话。 */
  takeAnnouncement(): CopyKey | '';
}

export const DemoControlContext = createContext<DemoControl | null>(null);

export function useDemoControl(): DemoControl {
  return useContext(DemoControlContext) ?? { active: false, enter() {}, exit() {}, returning: () => false, endReturn() {}, takeAnnouncement: () => '' };
}

/** 全新的示例环境：内存 store（不接任何存储端口、不自动保存）、独立 ui。真实数据一份都不复制。 */
export function createDemoContext(real: AppContext, env: Env = browserEnv()): AppContext {
  const initial = createSampleState(env, real.store.getState().settings);
  return { store: createStore({ env, initial }), ui: createUiStore(), roam: { positionOf: () => null } };
}

export interface HashSnapshot {
  hash: string;
  scrollX: number;
  scrollY: number;
}

export function takeSnapshot(): HashSnapshot {
  return { hash: window.location.hash, scrollX: window.scrollX, scrollY: window.scrollY };
}

/** 用替换而不是新增历史记录；不触发 hashchange，因为整棵界面树随后会重建。 */
export function writeHash(hash: string): void {
  const base = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState(window.history.state, '', hash ? `${base}${hash}` : base);
}

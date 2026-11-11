// 界面状态：选中谁、庆祝进行到哪。不持久化，不经过 domain reducer。
import type { Subscribable } from './store';

export type CelebrationPhase = 'gold' | 'wave' | 'stamp' | 'fly';

export interface Celebration {
  entryId: string;
  phase: CelebrationPhase;
  /** 暖灯是否已经点亮（飞行最后 0.5 秒才亮；跳过则直接亮）。 */
  lampOn: boolean;
}

export type Camera = 'focus' | 'panorama';

export interface UiState {
  selectedTaskId: string | null;
  /** 手机镜头：聚焦当前楼层，或看整栋的全景。宽屏忽略它。 */
  camera: Camera;
  /** 最近被创建、点击或勾选的 Ghost 所在楼层；null 表示还没有。 */
  focusFloor: number | null;
  /** 全景中点了某只 Ghost 后记下它；再点一次才打开详情。 */
  primedTaskId: string | null;
  celebration: Celebration | null;
  /**
   * 视觉上仍被离场者占着的 Slot（slotKey → 离场者的 taskId）。数据里这个 Slot 已经空了、可以被新住客分到，
   * 但新住客要等离场者走开（庆祝飞离后约 0.5 秒、搬走演完）才露面，免得两只叠在一起。
   */
  holds: ReadonlyMap<string, string>;
}

export interface UiStore extends Subscribable<UiState> {
  /** trigger 是被点击的 Ghost 按钮，关闭详情卡后焦点回到它。 */
  selectGhost(taskId: string, trigger?: HTMLElement | null): void;
  closeCard(): void;
  /**
   * 点了一只 Ghost。聚焦模式直接选中；全景模式先聚焦它所在的楼层并记下 primedTaskId，再点一次才打开详情。
   * 返回是否打开了详情。
   */
  activateGhost(taskId: string, floor: number, trigger?: HTMLElement | null): boolean;
  /** 切换镜头；进入全景时详情收起。 */
  setCamera(camera: Camera): void;
  setFocusFloor(floor: number | null): void;
  /** 取走并清空关闭后应当回到的触发元素。 */
  takeTrigger(): HTMLElement | null;
  setCelebration(c: Celebration | null): void;
  holdSlot(slotKey: string, taskId: string): void;
  releaseSlot(slotKey: string): void;
  releaseAllSlots(): void;
}

export function createUiStore(): UiStore {
  let state: UiState = { selectedTaskId: null, camera: 'focus', focusFloor: null, primedTaskId: null, celebration: null, holds: new Map() };
  let trigger: HTMLElement | null = null;
  const listeners = new Set<() => void>();
  const set = (next: UiState) => {
    state = next;
    for (const l of [...listeners]) l();
  };
  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    selectGhost(taskId, el) {
      if (el) trigger = el;
      if (taskId !== state.selectedTaskId) set({ ...state, selectedTaskId: taskId });
    },
    closeCard() {
      if (state.selectedTaskId !== null) set({ ...state, selectedTaskId: null });
    },
    activateGhost(taskId, floor, el) {
      if (state.camera === 'panorama') {
        set({ ...state, camera: 'focus', focusFloor: floor, primedTaskId: taskId });
        return false;
      }
      if (el) trigger = el;
      set({ ...state, selectedTaskId: taskId, focusFloor: floor, primedTaskId: null });
      return true;
    },
    setCamera(camera) {
      if (camera === state.camera) return;
      set({ ...state, camera, selectedTaskId: camera === 'panorama' ? null : state.selectedTaskId, primedTaskId: null });
    },
    setFocusFloor(floor) {
      if (floor !== state.focusFloor) set({ ...state, focusFloor: floor });
    },
    takeTrigger() {
      const t = trigger;
      trigger = null;
      return t;
    },
    setCelebration(c) {
      if (c === state.celebration) return;
      set({ ...state, celebration: c });
    },
    holdSlot(slotKey, taskId) {
      if (state.holds.get(slotKey) === taskId) return;
      set({ ...state, holds: new Map(state.holds).set(slotKey, taskId) });
    },
    releaseSlot(slotKey) {
      if (!state.holds.has(slotKey)) return;
      const holds = new Map(state.holds);
      holds.delete(slotKey);
      set({ ...state, holds });
    },
    releaseAllSlots() {
      if (state.holds.size > 0) set({ ...state, holds: new Map() });
    },
  };
}

// 极简订阅式 store：dispatch → reduce → state + events；可选的防抖自动保存与确认时的同步写入。
import { reduce } from '../domain/reducer';
import type { RecoveryResult } from '../persistence/recovery';
import { serializeSave } from '../persistence/serialize';
import type { SaveData } from '../persistence/types';
import { createMemoryPort, type StoragePort } from './storagePort';
import { persistCreation } from './persistCreation';
import { COLLECTION_SIZE } from '../domain/collection';
import { emptyState, type Action, type AnimEvent, type AppState, type Env, type ReduceResult } from '../domain/types';

export interface Subscribable<S> {
  getState(): S;
  subscribe(fn: () => void): () => void;
}

/** 确认完成的流程状态（不属于存档）：正在确认哪一只。 */
export interface Flow {
  confirmingId: string | null;
}

/** 这次会话的存放方式（不属于存档）。 */
export interface SessionInfo {
  /** normal：正常存取；recovery：读到的存档不能用，原文保留、不写任何键；memory：只在内存里继续。 */
  mode: 'normal' | 'recovery' | 'memory';
  /** 最近一次写入是否被存储拒绝（写满或不可用）。 */
  storage: 'ok' | 'unavailable';
  /** recovery 时读到的原始文本（阶段 7 的恢复界面使用）。 */
  raw: string | null;
}

/** 普通变更的防抖时长。 */
export const SAVE_DEBOUNCE_MS = 300;

export interface SaveClock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realClock: SaveClock = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface Store extends Subscribable<AppState> {
  flow: Subscribable<Flow>;
  session: Subscribable<SessionInfo>;
  /** 立刻写入尚未保存的变更（页面隐藏时调用）；没有变更或处于只读会话时什么都不做。 */
  flush(): void;
  /** 返回 reduce 的结果；被拒绝时 state 不变，error 说明原因。 */
  dispatch(action: Action): ReduceResult;
  /** 恢复界面的选项②：用空白数据在内存里继续。不写任何键；原文随即放下。 */
  continueInMemory(): void;
  /** 恢复界面的选项③：备份旧存档、写入新空存档并读回。只有 ok 才离开恢复会话；其余结果原样留在恢复会话。 */
  startFresh(): RecoveryResult;
  /** 进入示例前：先把已排队的保存处理掉，然后整个暂停——不接收任何动作，也不写任何键。 */
  freeze(): void;
  /** 示例结束：恢复接收动作；若还有没保存成功的变更，重新排队保存。 */
  thaw(): void;
  /** 订阅动画事件（纯数据，动画层消费，不回写 state）。 */
  subscribeEvents(fn: (events: readonly AnimEvent[]) => void): () => void;
}

export interface StoreOptions {
  env: Env;
  initial?: AppState;
  /** 同步写入并回读的端口；缺省为内存实现。 */
  port?: StoragePort;
  /** 开启后，普通变更在防抖后写入端口。缺省关闭（内存 store）。 */
  autosave?: boolean;
  clock?: SaveClock;
  session?: Partial<SessionInfo>;
  /** 恢复会话的副作用（备份与解锁）由外壳注入，store 与 reducer 自己不碰存储。 */
  recovery?: RecoveryActions;
}

export interface RecoveryActions {
  /** 备份 raw、写入 fresh 并读回；失败时返回错误，不抛。 */
  startFresh(raw: string, fresh: SaveData): RecoveryResult;
  /** 备份与新存档都确认之后，放开主键。 */
  unlock(): void;
}

export function createStore({ env, initial, port = createMemoryPort(), autosave = false, clock = realClock, session: start, recovery }: StoreOptions): Store {
  let state = initial ?? emptyState();
  let flow: Flow = { confirmingId: null };
  const listeners = new Set<() => void>();
  const flowListeners = new Set<() => void>();
  const eventListeners = new Set<(events: readonly AnimEvent[]) => void>();
  let session: SessionInfo = { mode: start?.mode ?? 'normal', storage: start?.storage ?? 'ok', raw: start?.raw ?? null };
  const sessionListeners = new Set<() => void>();
  let dirty = false;
  let timer: unknown = null;
  // 只有 normal 会话才会写存储；recovery 与 memory 下端口自己也是只读的，这里再挡一道，省得空转。
  let frozen = false;
  const writable = () => session.mode === 'normal' && !frozen;

  const setStorage = (storage: SessionInfo['storage']) => {
    if (session.storage === storage) return;
    session = { ...session, storage };
    for (const l of [...sessionListeners]) l();
  };

  const cancelTimer = () => {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
  };

  const flush = () => {
    cancelTimer();
    if (!dirty || !writable()) return;
    try {
      port.write(serializeSave(state));
      dirty = false;
      setStorage('ok');
    } catch {
      // 写满或不可用：state 留在内存里，变更仍算未保存，下次变更或隐藏页面时再试。
      setStorage('unavailable');
    }
  };

  const markDirty = () => {
    if (!autosave || !writable()) return;
    dirty = true;
    cancelTimer();
    timer = clock.setTimeout(flush, SAVE_DEBOUNCE_MS);
  };

  const setFlow = (confirmingId: string | null) => {
    if (flow.confirmingId === confirmingId) return;
    flow = { confirmingId };
    for (const l of [...flowListeners]) l();
  };

  /** 同步写入并回读：两步都成功且内容一致才算数。 */
  const persistOnce = (next: AppState): boolean => {
    try {
      const text = serializeSave(next);
      port.write(text);
      return port.readBack() === text;
    } catch {
      return false;
    }
  };

  const publish = (result: ReduceResult) => {
    if (result.state !== state) {
      state = result.state;
      markDirty();
      for (const l of [...listeners]) l();
    }
    if (result.events.length > 0) for (const l of [...eventListeners]) l(result.events);
  };

  const setSession = (next: SessionInfo) => {
    session = next;
    for (const l of [...sessionListeners]) l();
  };
  return {
    freeze() {
      if (frozen) return;
      flush();
      cancelTimer();
      frozen = true;
    },
    thaw() {
      if (!frozen) return;
      frozen = false;
      if (dirty && autosave && writable()) {
        cancelTimer();
        timer = clock.setTimeout(flush, SAVE_DEBOUNCE_MS);
      }
    },
    continueInMemory() {
      if (frozen || session.mode !== 'recovery') return;
      // 端口保持上锁：之后任何操作都不会碰存储。
      setSession({ mode: 'memory', storage: 'ok', raw: null });
    },
    startFresh() {
      if (frozen || session.mode !== 'recovery' || session.raw === null || !recovery) return { ok: false, error: 'backup-write-failed' };
      const fresh = emptyState();
      const result = recovery.startFresh(session.raw, fresh);
      if (!result.ok) return result;
      recovery.unlock();
      cancelTimer();
      dirty = false;
      state = fresh;
      setSession({ mode: 'normal', storage: 'ok', raw: null });
      for (const l of [...listeners]) l();
      return result;
    },
    flow: {
      getState: () => flow,
      subscribe(fn) {
        flowListeners.add(fn);
        return () => void flowListeners.delete(fn);
      },
    },
    session: {
      getState: () => session,
      subscribe(fn) {
        sessionListeners.add(fn);
        return () => void sessionListeners.delete(fn);
      },
    },
    flush,
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    subscribeEvents(fn) {
      eventListeners.add(fn);
      return () => void eventListeners.delete(fn);
    },
    dispatch(action) {
      // 暂停期间（示例里）：一律不收，state 引用不变。
      if (frozen) return { state, events: [], error: { kind: 'paused' } };
      if (action.type === 'BeginConfirm') {
        const result = reduce(state, action, env);
        if (!result.error) setFlow(action.taskId);
        return result;
      }
      if (action.type === 'CancelConfirm') {
        if (flow.confirmingId === action.taskId) setFlow(null);
        return { state, events: [] };
      }
      if (action.type === 'ConfirmComplete') {
        // 重复触发保护：不在确认对话框里，或对象不是正在确认的那只，一律忽略。
        if (flow.confirmingId !== action.taskId) return { state, events: [], error: { kind: 'not-confirming' } };
        const result = reduce(state, action, env);
        if (result.error) return result;
        // 先写入并回读，成功才提交；失败则丢弃新 state，不发事件，对话框保持打开。
        if (!persistOnce(result.state)) {
          if (writable()) setStorage('unavailable');
          return { state, events: [], error: { kind: 'save-failed' } };
        }
        setFlow(null);
        publish(result);
        // 这一次写入已经带上了全部变更，不必再等防抖。
        cancelTimer();
        dirty = false;
        if (writable()) setStorage('ok');
        return result;
      }
      const result = reduce(state, action, env);
      // Once unlocked, creation commits identity and the guarantee together before publishing.
      // Locked and memory ports keep their existing shadow-only behavior.
      if (action.type === 'CreateTask' && state.house.completedCount >= COLLECTION_SIZE && !result.error) {
        if (!persistCreation(port, state, result.state)) {
          if (writable()) setStorage('unavailable');
          return { state, events: [], error: { kind: 'save-failed' } };
        }
        publish(result);
        cancelTimer();
        dirty = false;
        if (writable()) setStorage('ok');
        return result;
      }
      // 搬走的正是正在确认的那只：确认流程一并收起，不留悬空的对话框状态。
      if (action.type === 'DeleteTask' && !result.error && flow.confirmingId === action.taskId) setFlow(null);
      publish(result);
      return result;
    },
  };
}

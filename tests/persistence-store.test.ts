import { describe, expect, it } from 'vitest';
import { PRIMARY_KEY } from '../src/persistence/keys';
import { parseSave } from '../src/persistence/parse';
import { serializeSave } from '../src/persistence/serialize';
import { createMemoryKv, type MemoryKv } from '../src/persistence/storage';
import { loadSave } from '../src/persistence/load';
import { emptyState, type Env } from '../src/domain/types';
import { createPersistentStore } from '../src/store/bootstrap';
import { SAVE_DEBOUNCE_MS, type SaveClock } from '../src/store/store';
import { createFakeClock } from './helpers/clock';

function makeEnv(): Env {
  let n = 0;
  return { now: () => '2026-11-08T08:00:00.000Z', today: () => '2026-11-08', newId: () => `id-${++n}` };
}

/** 把内存键值存储包成 Storage 的结构子集。 */
function asStorage(kv: MemoryKv) {
  return {
    get length() {
      return kv.keys().length;
    },
    key: (i: number) => kv.keys()[i] ?? null,
    getItem: (k: string) => kv.getItem(k),
    setItem: (k: string, v: string) => kv.setItem(k, v),
  };
}

function boot(kv: MemoryKv, clock: SaveClock = createFakeClock()) {
  return createPersistentStore({ storage: asStorage(kv), env: makeEnv(), clock });
}

const primaryWrites = (kv: MemoryKv) => kv.writes.filter(([k]) => k === PRIMARY_KEY);

function pending(store: ReturnType<typeof boot>) {
  store.dispatch({ type: 'CreateTask', title: 'Tidy the desk' });
  const id = store.getState().tasks[0]!.id;
  store.dispatch({ type: 'SetCriteria', taskId: id, criteria: 'Clear' });
  store.dispatch({ type: 'AddStep', taskId: id, title: 'one' });
  const step = store.getState().tasks[0]!.steps[0]!;
  store.dispatch({ type: 'ToggleStep', taskId: id, stepId: step.id });
  return id;
}

describe('启动只读加载', () => {
  it('没有存档：空数据只在内存里，启动与等待之后都零写入', () => {
    const kv = createMemoryKv();
    const clock = createFakeClock();
    const store = boot(kv, clock);
    clock.advance(10_000);
    expect(store.getState()).toEqual(emptyState());
    expect(store.session.getState()).toEqual({ mode: 'normal', storage: 'ok', raw: null });
    expect(kv.writes).toHaveLength(0);
  });

  it('首次变更才写入', () => {
    const kv = createMemoryKv();
    const clock = createFakeClock();
    const store = boot(kv, clock);
    store.dispatch({ type: 'CreateTask', title: 'Tidy the desk' });
    expect(kv.writes).toHaveLength(0);
    clock.advance(SAVE_DEBOUNCE_MS);
    expect(primaryWrites(kv)).toHaveLength(1);
  });

  it('被拒绝的动作不算变更', () => {
    const kv = createMemoryKv();
    const clock = createFakeClock();
    const store = boot(kv, clock);
    store.dispatch({ type: 'CreateTask', title: '   ' });
    clock.advance(1000);
    expect(kv.writes).toHaveLength(0);
  });

  it('合法存档被载入，载入本身不写', () => {
    const seed = createMemoryKv();
    const a = boot(seed);
    a.dispatch({ type: 'CreateTask', title: 'Tidy the desk' });
    a.flush();
    const saved = seed.getItem(PRIMARY_KEY)!;
    const kv = createMemoryKv({ [PRIMARY_KEY]: saved });
    const b = boot(kv);
    expect(b.getState().tasks.map((t) => t.title)).toEqual(['Tidy the desk']);
    expect(kv.writes).toHaveLength(0);
  });

  it('非法或不支持的数据：进入恢复状态，保留原文，主键上锁，之后怎么操作都不写任何键', () => {
    const bads = ['{oops', JSON.stringify({ schema_version: 2 }), serializeSave(emptyState()).replace('"tasks":[]', '"tasks":7')];
    for (const raw of bads) {
      const kv = createMemoryKv({ [PRIMARY_KEY]: raw });
      const clock = createFakeClock();
      const store = boot(kv, clock);
      expect(store.session.getState()).toEqual({ mode: 'recovery', storage: 'ok', raw });
      expect(store.getState()).toEqual(emptyState());
      store.dispatch({ type: 'CreateTask', title: 'Tidy the desk' });
      store.flush();
      clock.advance(10_000);
      expect(kv.writes).toHaveLength(0);
      expect(kv.getItem(PRIMARY_KEY)).toBe(raw);
      expect(kv.keys()).toEqual([PRIMARY_KEY]);
    }
  });

  it('恢复状态下确认完成仍在内存里成立，主键原文不动', () => {
    const raw = '{oops';
    const kv = createMemoryKv({ [PRIMARY_KEY]: raw });
    const store = boot(kv);
    const id = pending(store);
    store.dispatch({ type: 'BeginConfirm', taskId: id });
    expect(store.dispatch({ type: 'ConfirmComplete', taskId: id, memo: '' }).error).toBeUndefined();
    expect(store.getState().archive).toHaveLength(1);
    expect(kv.writes).toHaveLength(0);
    expect(kv.getItem(PRIMARY_KEY)).toBe(raw);
  });

  it('存储读取就抛错：内存模式，提示收不起来，零写入', () => {
    const kv = createMemoryKv();
    kv.failReads(true);
    const clock = createFakeClock();
    const store = boot(kv, clock);
    expect(store.session.getState()).toEqual({ mode: 'memory', storage: 'unavailable', raw: null });
    store.dispatch({ type: 'CreateTask', title: 'A' });
    clock.advance(1000);
    expect(store.getState().tasks).toHaveLength(1);
    expect(kv.writes).toHaveLength(0);
  });

  it('没有存储对象（被禁用）：同样进入内存模式', () => {
    const store = createPersistentStore({ storage: null, env: makeEnv(), clock: createFakeClock() });
    expect(store.session.getState().mode).toBe('memory');
    expect(store.session.getState().storage).toBe('unavailable');
    store.dispatch({ type: 'CreateTask', title: 'A' });
    expect(store.getState().tasks).toHaveLength(1);
  });

  it('loadSave 区分四种结果', () => {
    expect(loadSave(null).kind).toBe('unavailable');
    expect(loadSave(createMemoryKv()).kind).toBe('fresh');
    expect(loadSave(createMemoryKv({ [PRIMARY_KEY]: serializeSave(emptyState()) })).kind).toBe('loaded');
    expect(loadSave(createMemoryKv({ [PRIMARY_KEY]: 'x' })).kind).toBe('recovery');
  });
});

describe('防抖保存', () => {
  it('300ms 内多次变更只写一次，写入的是最新的完整存档', () => {
    const kv = createMemoryKv();
    const clock = createFakeClock();
    const store = boot(kv, clock);
    store.dispatch({ type: 'CreateTask', title: 'A' });
    clock.advance(SAVE_DEBOUNCE_MS - 1);
    store.dispatch({ type: 'CreateTask', title: 'B' });
    clock.advance(SAVE_DEBOUNCE_MS - 1);
    expect(kv.writes).toHaveLength(0);
    clock.advance(1);
    expect(primaryWrites(kv)).toHaveLength(1);
    const saved = parseSave(kv.getItem(PRIMARY_KEY)!);
    expect(saved.ok && saved.value.tasks.map((t) => t.title)).toEqual(['A', 'B']);
  });

  it('隐藏页面时立即补写；之后没有新变更就不重复写', () => {
    const kv = createMemoryKv();
    const clock = createFakeClock();
    const store = boot(kv, clock);
    store.dispatch({ type: 'CreateTask', title: 'A' });
    store.flush();
    expect(primaryWrites(kv)).toHaveLength(1);
    store.flush();
    clock.advance(1000);
    expect(primaryWrites(kv)).toHaveLength(1);
    expect(clock.pending()).toBe(0);
  });

  it('确认完成同步写入并读回，不走防抖；之后没有多余的写入', () => {
    const kv = createMemoryKv();
    const clock = createFakeClock();
    const store = boot(kv, clock);
    const id = pending(store);
    store.dispatch({ type: 'BeginConfirm', taskId: id });
    store.dispatch({ type: 'ConfirmComplete', taskId: id, memo: 'done' });
    expect(primaryWrites(kv)).toHaveLength(1);
    const saved = parseSave(kv.getItem(PRIMARY_KEY)!);
    expect(saved.ok && saved.value.archive).toHaveLength(1);
    clock.advance(10_000);
    expect(primaryWrites(kv)).toHaveLength(1);
  });

  it('确认时写入失败：回滚、无事件、提示收不起来；存储恢复后下次变更补写成功', () => {
    const kv = createMemoryKv();
    const clock = createFakeClock();
    const store = boot(kv, clock);
    const id = pending(store);
    const before = store.getState();
    const events: unknown[] = [];
    store.subscribeEvents((e) => events.push(...e));
    store.dispatch({ type: 'BeginConfirm', taskId: id });
    kv.failWrites(true);
    const r = store.dispatch({ type: 'ConfirmComplete', taskId: id, memo: '' });
    expect(r.error).toEqual({ kind: 'save-failed' });
    expect(store.getState()).toBe(before);
    expect(events).toEqual([]);
    expect(store.flow.getState().confirmingId).toBe(id);
    expect(store.session.getState().storage).toBe('unavailable');
    kv.failWrites(false);
    expect(store.dispatch({ type: 'ConfirmComplete', taskId: id, memo: '' }).error).toBeUndefined();
    expect(store.session.getState().storage).toBe('ok');
  });

  it('确认时读回不一致同样回滚', () => {
    const kv = createMemoryKv();
    const store = boot(kv);
    const id = pending(store);
    store.dispatch({ type: 'BeginConfirm', taskId: id });
    const real = kv.getItem.bind(kv);
    kv.getItem = (k) => (k === PRIMARY_KEY ? 'tampered' : real(k));
    const before = store.getState();
    expect(store.dispatch({ type: 'ConfirmComplete', taskId: id, memo: '' }).error).toEqual({ kind: 'save-failed' });
    expect(store.getState()).toBe(before);
  });
});

describe('存储写满', () => {
  it('state 留在内存里，状态变为“收不起来”，提示订阅者；空间回来后下一次变更写成功', () => {
    const kv = createMemoryKv();
    const clock = createFakeClock();
    const store = boot(kv, clock);
    let notified = 0;
    store.session.subscribe(() => notified++);
    kv.failWrites(true);
    store.dispatch({ type: 'CreateTask', title: 'A' });
    clock.advance(SAVE_DEBOUNCE_MS);
    expect(store.session.getState().storage).toBe('unavailable');
    expect(notified).toBe(1);
    expect(store.getState().tasks).toHaveLength(1);
    store.dispatch({ type: 'CreateTask', title: 'B' });
    clock.advance(SAVE_DEBOUNCE_MS);
    expect(store.getState().tasks).toHaveLength(2);
    expect(kv.writes).toHaveLength(0);

    kv.failWrites(false);
    store.dispatch({ type: 'CreateTask', title: 'C' });
    clock.advance(SAVE_DEBOUNCE_MS);
    expect(store.session.getState().storage).toBe('ok');
    const saved = parseSave(kv.getItem(PRIMARY_KEY)!);
    expect(saved.ok && saved.value.tasks).toHaveLength(3);
  });

  it('页面隐藏时的补写失败也不丢内存数据、不抛出', () => {
    const kv = createMemoryKv();
    const store = boot(kv);
    store.dispatch({ type: 'CreateTask', title: 'A' });
    kv.failWrites(true);
    expect(() => store.flush()).not.toThrow();
    expect(store.getState().tasks).toHaveLength(1);
    expect(store.session.getState().storage).toBe('unavailable');
  });
});

describe('恢复会话的控制接口', () => {
  it('continueInMemory：只改会话方式，不写任何键，之后变更与隐藏页面都零写入', () => {
    const raw = '{oops';
    const kv = createMemoryKv({ [PRIMARY_KEY]: raw });
    const clock = createFakeClock();
    const store = boot(kv, clock);
    store.continueInMemory();
    expect(store.session.getState()).toEqual({ mode: 'memory', storage: 'ok', raw: null });
    store.dispatch({ type: 'CreateTask', title: 'A' });
    store.flush();
    clock.advance(10_000);
    expect(kv.writes).toHaveLength(0);
    expect(kv.getItem(PRIMARY_KEY)).toBe(raw);
    store.continueInMemory(); // 重复调用无影响
    expect(store.session.getState().mode).toBe('memory');
  });

  it('非恢复会话里 continueInMemory 与 startFresh 什么都不做', () => {
    const kv = createMemoryKv();
    const store = boot(kv);
    store.continueInMemory();
    expect(store.session.getState().mode).toBe('normal');
    expect(store.startFresh().ok).toBe(false);
    expect(kv.writes).toHaveLength(0);
  });

  it('startFresh 成功：解锁、清掉原文、之后的变更才写主键', () => {
    const raw = '{oops';
    const kv = createMemoryKv({ [PRIMARY_KEY]: raw });
    const clock = createFakeClock();
    const store = boot(kv, clock);
    const result = store.startFresh();
    expect(result).toEqual({ ok: true, backupKey: 'ub:backup:1' });
    expect(store.session.getState()).toEqual({ mode: 'normal', storage: 'ok', raw: null });
    expect(kv.getItem('ub:backup:1')).toBe(raw);
    store.dispatch({ type: 'CreateTask', title: 'A' });
    clock.advance(400);
    const saved = parseSave(kv.getItem(PRIMARY_KEY)!);
    expect(saved.ok && saved.value.tasks).toHaveLength(1);
  });

  it('startFresh 失败：仍在恢复会话、主键仍上锁，之后的变更不写', () => {
    const raw = '{oops';
    const kv = createMemoryKv({ [PRIMARY_KEY]: raw });
    const clock = createFakeClock();
    const store = boot(kv, clock);
    kv.failWrites(true);
    expect(store.startFresh().ok).toBe(false);
    kv.failWrites(false);
    expect(store.session.getState()).toEqual({ mode: 'recovery', storage: 'ok', raw });
    store.dispatch({ type: 'CreateTask', title: 'A' });
    store.flush();
    clock.advance(10_000);
    expect(kv.writes).toHaveLength(0);
    expect(kv.getItem(PRIMARY_KEY)).toBe(raw);
  });
});

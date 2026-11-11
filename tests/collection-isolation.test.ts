import { expect, it, vi } from 'vitest';
import { createDemoContext } from '../src/demo/control';
import { createPersistentStore } from '../src/store/bootstrap';
import { createUiStore } from '../src/store/uiStore';
import { createMemoryKv, type MemoryKv } from '../src/persistence/storage';
import { emptyState, type Env } from '../src/domain/types';
import { serializeSave } from '../src/persistence/serialize';
import { lanternDue } from '../src/domain/collection';
import type { Store } from '../src/store/store';
import { createFakeClock } from './helpers/clock';

function setup(raw?: string) {
  let n = 0;
  const random = vi.fn(() => .8);
  const env: Env = { now: () => '2026-11-09T00:00:00.000Z', today: () => '2026-11-09', newId: () => `fixture-${++n}`, random };
  const kv = createMemoryKv(raw ? { 'ub:save': raw, 'ub:backup:1': 'Keep this historical backup' } : {});
  const clock = createFakeClock();
  const store = createPersistentStore({ storage: storage(kv), clock, env });
  return { kv, store, clock, env, random };
}
function storage(kv: MemoryKv) {
  return { get length() { return kv.keys().length; }, key: (i: number) => kv.keys()[i] ?? null, getItem: kv.getItem, setItem: kv.setItem };
}
function finish(store: Store) {
  expect(store.dispatch({ type: 'CreateTask', title: 'A private task' }).error).toBeUndefined();
  const task = store.getState().tasks.at(-1)!;
  store.dispatch({ type: 'SetCriteria', taskId: task.id, criteria: 'Done' });
  store.dispatch({ type: 'AddStep', taskId: task.id, title: 'One' });
  store.dispatch({ type: 'ToggleStep', taskId: task.id, stepId: store.getState().tasks.at(-1)!.steps[0]!.id });
  store.dispatch({ type: 'BeginConfirm', taskId: task.id });
  expect(store.dispatch({ type: 'ConfirmComplete', taskId: task.id, memo: '' }).error).toBeUndefined();
}

it('recovery and its memory continuation can unlock and welcome a lantern without writing any key', () => {
  const raw = '{ unreadable test save';
  const { store, kv, clock, random } = setup(raw);
  expect(store.session.getState().mode).toBe('recovery');
  store.dispatch({ type: 'SetLang', lang: 'zh-CN' });
  expect(kv.writes).toHaveLength(0);
  store.continueInMemory();
  for (let i = 0; i < 12; i++) finish(store);
  expect(lanternDue(store.getState())).toBe(true);
  expect(store.dispatch({ type: 'CreateTask', title: 'Lantern' }).error).toBeUndefined();
  expect(store.getState().tasks[0]!.ghostKind).toBe('lantern');
  clock.advance(10000); store.flush();
  expect(kv.writes).toHaveLength(0);
  expect(kv.getItem('ub:save')).toBe(raw);
  expect(kv.getItem('ub:backup:1')).toBe('Keep this historical backup');
  expect(random).not.toHaveBeenCalled();
});

it('unavailable storage keeps collection and identity only in memory, without changing backups', () => {
  const { kv, clock, env } = setup(); kv.failReads(true);
  const store = createPersistentStore({ storage: storage(kv), clock, env });
  expect(store.session.getState().mode).toBe('memory');
  for (let i = 0; i < 12; i++) finish(store);
  store.dispatch({ type: 'CreateTask', title: 'Lantern' });
  expect(store.getState().tasks[0]!.ghostKind).toBe('lantern');
  clock.advance(10000); store.flush();
  expect(kv.writes).toHaveLength(0);
});

it('a sample can independently collect and welcome while the real guarantee remains unchanged', () => {
  const { store, kv, clock, env } = setup(serializeSave(emptyState()));
  for (let i = 0; i < 12; i++) finish(store);
  store.flush();
  const original = kv.getItem('ub:save');
  const writes = kv.writes.length;
  const real = { store, ui: createUiStore(), roam: { positionOf: () => null } };
  store.freeze();
  const sample = createDemoContext(real, env);
  // Sample begins with one ordinary task; leave it quietly before exercising its own collection.
  sample.store.dispatch({ type: 'DeleteTask', taskId: sample.store.getState().tasks[0]!.id });
  expect(sample.store.getState().house.completedCount).toBe(0);
  for (let i = 0; i < 12; i++) finish(sample.store);
  sample.store.dispatch({ type: 'CreateTask', title: 'Sample lantern' });
  expect(sample.store.getState().tasks[0]!.ghostKind).toBe('lantern');
  clock.advance(10000); sample.store.flush(); store.flush();
  expect(kv.writes).toHaveLength(writes);
  expect(kv.getItem('ub:save')).toBe(original);
  store.thaw();
  expect(lanternDue(store.getState())).toBe(true);
  store.dispatch({ type: 'CreateTask', title: 'Real lantern' });
  expect(store.getState().tasks[0]!.ghostKind).toBe('lantern');
  expect(kv.getItem('ub:backup:1')).toBe('Keep this historical backup');
});

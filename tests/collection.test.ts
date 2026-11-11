import { describe, expect, it, vi } from 'vitest';
import { collectedCount, lanternDue, LANTERN_CHANCE, newGhostKind, STAMPS, stampFor } from '../src/domain/collection';
import { reduce } from '../src/domain/reducer';
import { emptyState, type AppState, type Env } from '../src/domain/types';
import { parseSave } from '../src/persistence/parse';
import { serializeSave } from '../src/persistence/serialize';
import { createMemoryPort } from '../src/store/storagePort';
import { createStore } from '../src/store/store';
import { STAMP_PATHS } from '../src/house/stampShapes';
import { REVEAL_ORDER } from '../src/house/reveal';

function fixture(completed = 0) {
  let id = 0;
  const random = vi.fn(() => .8);
  const env: Env = { now: () => '2026-11-09T00:00:00.000Z', today: () => '2026-11-09', newId: () => `test-${++id}`, random };
  let state = emptyState();
  for (let i = 0; i < completed; i++) {
    state = reduce(state, { type: 'CreateTask', title: `Private ${i}` }, env).state;
    state = complete(state, env);
  }
  return { state, env, random };
}

function complete(state: AppState, env: Env): AppState {
  const taskId = state.tasks.at(-1)!.id;
  state = reduce(state, { type: 'SetCriteria', taskId, criteria: 'Done' }, env).state;
  state = reduce(state, { type: 'AddStep', taskId, title: 'Step' }, env).state;
  state = reduce(state, { type: 'ToggleStep', taskId, stepId: state.tasks.at(-1)!.steps[0]!.id }, env).state;
  return reduce(state, { type: 'ConfirmComplete', taskId, memo: '' }, env).state;
}

describe('collection progression and old saves', () => {
  it('twelve different object drawings unlock in order; memorials continue after twelve', () => {
    expect(STAMPS).toEqual(['envelope', 'key', 'cup', 'crane', 'boat', 'candle', 'moon', 'kite', 'watch', 'umbrella', 'seed', 'door']);
    expect(new Set(Object.values(STAMP_PATHS)).size).toBe(12);
    const { state } = fixture(26);
    expect(state.archive).toHaveLength(26);
    expect(state.house.completedCount).toBe(26);
    expect(collectedCount(26)).toBe(12);
    expect(state.archive.map((_, i) => stampFor(i)).slice(0, 13)).toEqual([...STAMPS, 'envelope']);
  });

  it.each([0, 1, 10, 11, 12, 13, 40])('legacy save with %i memorials preserves everything and derives the right guarantee', (n) => {
    const { state, env } = fixture(n);
    delete state.collection;
    for (const entry of state.archive) delete entry.ghostKind;
    state.tasks = [{ id: 'old', ghostNo: 999, title: 'Original', criteria: '', steps: [], slot: { floor: 2, slot: 0 }, createdAt: env.now() }];
    state.nextGhostNo = 1000;
    const loaded = parseSave(serializeSave(state));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value).toEqual(state);
    expect(collectedCount(n)).toBe(Math.min(n, 12));
    expect(lanternDue(loaded.value)).toBe(n >= 12);
    const next = reduce(loaded.value, { type: 'CreateTask', title: 'Next' }, env).state;
    expect(next.tasks[0]).toEqual(state.tasks[0]);
    expect(next.tasks[1]!.ghostKind).toBe(n >= 12 ? 'lantern' : 'ordinary');
    expect(next.archive).toEqual(state.archive);
  });

  it('rejects malformed extension fields instead of quietly losing identity', () => {
    const { state, env } = fixture(12);
    const next = reduce(state, { type: 'CreateTask', title: 'Hello' }, env).state;
    for (const change of [(s: any) => { s.collection = null; }, (s: any) => { s.collection.lanternWelcomed = 'yes'; }, (s: any) => { s.tasks[0].ghostKind = 'gold'; }, (s: any) => { s.archive[0].ghostKind = 5; }]) {
      const raw = JSON.parse(serializeSave(next)); change(raw);
      expect(parseSave(JSON.stringify(raw)).ok).toBe(false);
    }
  });

  it('guarantee and resident identity survive repeated save/load without sampling', () => {
    const { state, env, random } = fixture(12);
    let current = state;
    for (let i = 0; i < 3; i++) {
      const parsed = parseSave(serializeSave(current));
      if (!parsed.ok) throw new Error('fixture');
      current = parsed.value;
      expect(lanternDue(current)).toBe(true);
    }
    current = reduce(current, { type: 'CreateTask', title: 'Lantern' }, env).state;
    expect(current.tasks[0]!.ghostKind).toBe('lantern');
    expect(current.collection?.lanternWelcomed).toBe(true);
    expect(random).not.toHaveBeenCalled();
    expect(parseSave(serializeSave(current))).toEqual({ ok: true, value: current });
    current = complete(current, env);
    expect(current.archive.at(-1)!.ghostKind).toBe('lantern');
  });

  it('invalid input and a full house leave the guarantee, counters and random source untouched', () => {
    const { state, env, random } = fixture(12);
    for (const title of ['', ' '.repeat(3), 'a'.repeat(81)]) {
      const rejected = reduce(state, { type: 'CreateTask', title }, env);
      expect(rejected.state).toBe(state); expect(rejected.events).toEqual([]);
    }
    let full = emptyState();
    // Fill before unlocking so the first welcome remains owed.
    for (let i = 0; i < 10; i++) {
      full = reduce(full, { type: 'CreateTask', title: 'Resident' }, env).state;
    }
    full = { ...full, archive: state.archive, house: { grownFloors: 6, completedCount: 12 } };
    expect(reduce(full, { type: 'CreateTask', title: 'Waiting' }, env).state).toBe(full);
    expect(lanternDue(full)).toBe(true);
    expect(random).not.toHaveBeenCalled();
  });
});

describe('5% selection, once per successful creation', () => {
  it.each([[0, 'lantern'], [.049999, 'lantern'], [LANTERN_CHANCE, 'ordinary'], [.5, 'ordinary'], [.999999, 'ordinary'], [-1, 'ordinary'], [NaN, 'ordinary'], [1, 'ordinary']] as const)('%s selects %s', (sample, expected) => {
    const { state, env, random } = fixture(12);
    state.collection = { lanternWelcomed: true };
    random.mockReturnValue(sample);
    expect(newGhostKind(state, env)).toBe(expected);
    expect(random).toHaveBeenCalledTimes(1);
  });

  it('the exact 100 equally spaced controlled samples select five lanterns', () => {
    const { state, env, random } = fixture(12);
    state.collection = { lanternWelcomed: true };
    const results = Array.from({ length: 100 }, (_, i) => { random.mockReturnValue(i / 100); return newGhostKind(state, env); });
    expect(results.filter((kind) => kind === 'lantern')).toHaveLength(5);
  });
});

describe('creation commit', () => {
  it.each(['write-throws', 'readback-throws', 'readback-null', 'readback-differs'] as const)('%s cannot consume guarantee or emit welcome, then retry commits synchronously', (failure) => {
    const { state, env, random } = fixture(12);
    const port = createMemoryPort();
    port.write(serializeSave(state));
    const store = createStore({ initial: state, env, port, autosave: true });
    const events = vi.fn(); store.subscribeEvents(events);
    port.failWith(failure);
    expect(store.dispatch({ type: 'CreateTask', title: 'A lantern' }).error?.kind).toBe('save-failed');
    expect(store.getState()).toBe(state);
    expect(events).not.toHaveBeenCalled();
    expect(random).not.toHaveBeenCalled();
    port.failWith(null);
    const saved = port.readBack();
    if (saved) expect(parseSave(saved)).toEqual({ ok: true, value: state });
    const next = store.dispatch({ type: 'CreateTask', title: 'A lantern' });
    expect(next.error).toBeUndefined();
    expect(next.state.tasks[0]!.ghostKind).toBe('lantern');
    expect(parseSave(port.readBack()!)).toEqual({ ok: true, value: next.state });
    store.flush();
  });

  it('the reveal is a fixed permutation, corners first and face cells last', () => {
    expect([...REVEAL_ORDER].sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i));
    expect(REVEAL_ORDER.slice(0, 4)).toEqual([0, 3, 8, 11]);
    expect(REVEAL_ORDER.slice(-2)).toEqual([5, 6]);
  });
});

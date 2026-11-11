import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createDemoContext } from '../src/demo/control';
import { createSampleState } from '../src/demo/sample';
import { choreFor } from '../src/domain/progress';
import { evaluate } from '../src/domain/evaluate';
import { BACKUP_PREFIX, PRIMARY_KEY } from '../src/persistence/keys';
import { serializeSave } from '../src/persistence/serialize';
import { createPersistentStore } from '../src/store/bootstrap';
import { createStore } from '../src/store/store';
import { createUiStore } from '../src/store/uiStore';
import { emptyState, type Action, type Env } from '../src/domain/types';
import { en } from '../src/i18n/en';
import { createFakeClock } from './helpers/clock';
import { faultyKv } from './helpers/faultyKv';

const mkEnv = (): Env => {
  let n = 0;
  return { now: () => '2026-11-08T08:00:00.000Z', today: () => '2026-11-08', newId: () => `id-${++n}` };
};
const storageOf = (kv: ReturnType<typeof faultyKv>) => ({
  get length() { return kv.keys().length; },
  key: (i: number) => kv.keys()[i] ?? null,
  getItem: (k: string) => kv.getItem(k),
  setItem: (k: string, v: string) => kv.setItem(k, v),
});

describe('示例幽灵', () => {
  it('二楼左侧、英文标题、条件已填、三步未完成且依次是扫地/浇花/擦窗', () => {
    const state = createSampleState(mkEnv(), { lang: 'en' });
    expect(state.tasks).toHaveLength(1);
    const task = state.tasks[0]!;
    expect(task.slot).toEqual({ floor: 2, slot: 0 });
    expect(task.title).toBe('Tidy the desk');
    expect(task.criteria.trim().length).toBeGreaterThan(0);
    expect(task.steps.map((s) => s.done)).toEqual([false, false, false]);
    expect(task.steps.map((_, i) => choreFor(i))).toEqual(['sweep', 'water', 'window']);
    expect(task.steps.map((s) => s.title)).toEqual([en['demo.sample.step1'], en['demo.sample.step2'], en['demo.sample.step3']]);
    expect(evaluate(task)).toBe('white');
    expect(state.archive).toEqual([]);
    expect(state.house.completedCount).toBe(0);
  });
});

describe('store 暂停', () => {
  it('暂停时：任何动作都不收、state 引用不变、不写；已排队的保存在暂停时先处理', () => {
    const clock = createFakeClock();
    const writes: string[] = [];
    const store = createStore({ env: mkEnv(), port: { write: (t) => void writes.push(t), readBack: () => writes.at(-1) ?? null }, autosave: true, clock });
    store.dispatch({ type: 'CreateTask', title: 'a' });
    expect(writes).toHaveLength(0);
    store.freeze();
    expect(writes).toHaveLength(1);
    const state = store.getState();
    const result = store.dispatch({ type: 'CreateTask', title: 'b' });
    expect(result.error).toEqual({ kind: 'paused' });
    expect(store.getState()).toBe(state);
    clock.advance(10_000);
    store.flush();
    expect(writes).toHaveLength(1);
    store.thaw();
    store.dispatch({ type: 'CreateTask', title: 'b' });
    clock.advance(1000);
    expect(writes).toHaveLength(2);
  });

  it('暂停时存储拒绝过写入：恢复后重新排队保存', () => {
    const clock = createFakeClock();
    let fail = true;
    const writes: string[] = [];
    const store = createStore({
      env: mkEnv(),
      port: { write: (t) => { if (fail) throw new Error('full'); writes.push(t); }, readBack: () => writes.at(-1) ?? null },
      autosave: true,
      clock,
    });
    store.dispatch({ type: 'CreateTask', title: 'a' });
    store.freeze();
    fail = false;
    clock.advance(10_000);
    expect(writes).toHaveLength(0);
    store.thaw();
    clock.advance(1000);
    expect(writes).toHaveLength(1);
  });
});

type Op = { kind: 'create' | 'add' | 'toggle' | 'begin' | 'confirm' | 'cancel' | 'title'; n: number; text: string };
const opArb: fc.Arbitrary<Op> = fc.record({
  kind: fc.constantFrom('create', 'add', 'toggle', 'toggle', 'toggle', 'begin', 'confirm', 'cancel', 'title'),
  n: fc.nat(3),
  text: fc.string({ maxLength: 20 }),
});

/** 把随机操作落到 store 当前真实存在的 id 上，这样主线动作真的会生效。 */
function toAction(op: Op, state: { tasks: { id: string; steps: { id: string }[] }[]; archive: { id: string }[] }): Action | null {
  const task = state.tasks[0];
  switch (op.kind) {
    case 'create': return { type: 'CreateTask', title: op.text };
    case 'add': return task ? { type: 'AddStep', taskId: task.id, title: op.text } : null;
    case 'toggle': return task?.steps[op.n % Math.max(1, task.steps.length)] ? { type: 'ToggleStep', taskId: task.id, stepId: task.steps[op.n % task.steps.length]!.id } : null;
    case 'begin': return task ? { type: 'BeginConfirm', taskId: task.id } : null;
    case 'confirm': return task ? { type: 'ConfirmComplete', taskId: task.id, memo: op.text } : null;
    case 'cancel': return task ? { type: 'CancelConfirm', taskId: task.id } : null;
    case 'title': return state.archive[0] ? { type: 'ToggleTitleVisible', entryId: state.archive[0].id } : null;
  }
}

describe('Feature: unfinished-business, Property 12: Demo 与恢复/内存模式隔离', () => {
  it('Demo 上的任意动作不改真实存档；恢复界面与内存模式下的任意动作（含语言切换）对主键与备份键写入 0 次', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 40 }), (ops) => {
        const kv = faultyKv({ [PRIMARY_KEY]: serializeSave(emptyState()), [`${BACKUP_PREFIX}2026-10-01`]: 'older' });
        const clock = createFakeClock();
        const real = createPersistentStore({ storage: storageOf(kv), env: mkEnv(), clock });
        const ctx = { store: real, ui: createUiStore(), roam: { positionOf: () => null } };
        const snapshot = Object.fromEntries(kv.keys().map((k) => [k, kv.peek(k)]));
        const stateBefore = real.getState();
        const uiBefore = ctx.ui.getState();

        real.freeze();
        const demo = createDemoContext(ctx, mkEnv());
        for (const op of ops) {
          const a = toAction(op, demo.store.getState());
          if (!a) continue;
          demo.store.dispatch(a);
          const stray = toAction(op, real.getState());
          if (stray) real.dispatch(stray); // 真实 store 同时被“误操作”也不接收
        }
        demo.store.flush();
        clock.advance(60_000);

        expect(kv.attempts).toHaveLength(0);
        expect(Object.fromEntries(kv.keys().map((k) => [k, kv.peek(k)]))).toEqual(snapshot);
        expect(real.getState()).toBe(stateBefore);
        expect(ctx.ui.getState()).toBe(uiBefore);
        real.thaw();
        expect(real.getState()).toBe(stateBefore);

        // 恢复界面与内存模式：同样的任意动作加上语言切换，主键与备份键一次都不写。
        const raw = '{smudged notebook';
        const broken = faultyKv({ [PRIMARY_KEY]: raw, [`${BACKUP_PREFIX}1`]: 'older' });
        const bootClock = createFakeClock();
        const session = createPersistentStore({ storage: storageOf(broken), env: mkEnv(), clock: bootClock });
        for (const mode of ['recovery', 'memory'] as const) {
          if (mode === 'memory') session.continueInMemory();
          for (const op of ops) {
            const a = toAction(op, session.getState());
            if (a) session.dispatch(a);
            session.dispatch({ type: 'SetLang', lang: op.n % 2 === 0 ? 'en' : 'zh-CN' });
          }
          session.flush();
          bootClock.advance(60_000);
          expect(broken.attempts, mode).toEqual([]);
          expect(broken.peek(PRIMARY_KEY)).toBe(raw);
          expect(broken.peek(`${BACKUP_PREFIX}1`)).toBe('older');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('Demo 完整主线只落在 Demo store：纪念册有一条、门厅一盏灯；真实 state 的纪念册为空', () => {
    const real = createStore({ env: mkEnv() });
    const ctx = { store: real, ui: createUiStore(), roam: { positionOf: () => null } };
    const demo = createDemoContext(ctx, mkEnv());
    const task = demo.store.getState().tasks[0]!;
    for (const s of task.steps) demo.store.dispatch({ type: 'ToggleStep', taskId: task.id, stepId: s.id });
    demo.store.dispatch({ type: 'BeginConfirm', taskId: task.id });
    expect(demo.store.dispatch({ type: 'ConfirmComplete', taskId: task.id, memo: '' }).error).toBeUndefined();
    expect(demo.store.getState().archive).toHaveLength(1);
    expect(demo.store.getState().house.completedCount).toBe(1);
    expect(real.getState().archive).toEqual([]);
    expect(real.getState().house.completedCount).toBe(0);
  });
});

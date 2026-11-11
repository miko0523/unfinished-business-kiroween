import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { reduce } from '../src/domain/reducer';
import { lampsFor } from '../src/domain/house';
import { evaluate, isPendingConfirmation } from '../src/domain/evaluate';
import { emptyState, type Action, type AppState, type Env } from '../src/domain/types';
import { createStore } from '../src/store/store';
import { createMemoryPort, type InjectedFailure } from '../src/store/storagePort';
import { announce } from '../src/store/announce';

function makeEnv(): Env {
  let n = 0;
  return { now: () => `2026-11-08T0${Math.min(9, n)}:00:00.000Z`, today: () => '2026-11-08', newId: () => `id-${++n}` };
}

/** 依次应用动作，要求全部被接受。 */
function run(actions: Action[], env = makeEnv(), from: AppState = emptyState()): AppState {
  let s = from;
  for (const a of actions) {
    const r = reduce(s, a, env);
    expect(r.error).toBeUndefined();
    s = r.state;
  }
  return s;
}

/** 一只已经全部完成、等待确认的 Task，返回 store 与 id。 */
function pendingStore(steps = 3, port = createMemoryPort()) {
  const env = makeEnv();
  const store = createStore({ env, port });
  store.dispatch({ type: 'CreateTask', title: 'Tidy the desk' });
  const id = store.getState().tasks[0]!.id;
  store.dispatch({ type: 'SetCriteria', taskId: id, criteria: 'Clear' });
  for (let i = 0; i < steps; i++) store.dispatch({ type: 'AddStep', taskId: id, title: `s${i}` });
  for (const s of store.getState().tasks[0]!.steps) store.dispatch({ type: 'ToggleStep', taskId: id, stepId: s.id });
  return { store, id, port, env };
}

describe('步骤的编辑、删除与上下移', () => {
  const base = () =>
    run([
      { type: 'CreateTask', title: 'T' },
      { type: 'AddStep', taskId: 'id-1', title: 'a' },
      { type: 'AddStep', taskId: 'id-1', title: 'b' },
      { type: 'AddStep', taskId: 'id-1', title: 'c' },
      { type: 'ToggleStep', taskId: 'id-1', stepId: 'id-3' },
    ]);

  it('编辑：trim 后保存；空与超 80 被拒且 state 引用不变', () => {
    const s = base();
    const ok = reduce(s, { type: 'EditStep', taskId: 'id-1', stepId: 'id-2', title: '  hello  ' }, makeEnv());
    expect(ok.state.tasks[0]!.steps[0]!.title).toBe('hello');
    for (const title of ['   ', 'x'.repeat(81)]) {
      const r = reduce(s, { type: 'EditStep', taskId: 'id-1', stepId: 'id-2', title }, makeEnv());
      expect(r.error).toBeDefined();
      expect(r.state).toBe(s);
    }
  });

  it('上下移：其他步骤的完成标记不变（标记跟着各自的步骤走）；边界处被拒', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.constantFrom('up', 'down') as fc.Arbitrary<'up' | 'down'>, fc.integer({ min: 0, max: 2 })), { maxLength: 12 }), (moves) => {
        let s = base();
        const doneById = new Map(s.tasks[0]!.steps.map((x) => [x.id, x.done]));
        for (const [direction, i] of moves) {
          const stepId = s.tasks[0]!.steps[i]!.id;
          const r = reduce(s, { type: 'MoveStep', taskId: 'id-1', stepId, direction }, makeEnv());
          s = r.state;
        }
        expect(new Map(s.tasks[0]!.steps.map((x) => [x.id, x.done]))).toEqual(doneById);
        expect(s.tasks[0]!.steps).toHaveLength(3);
      }),
    );
    const s = base();
    expect(reduce(s, { type: 'MoveStep', taskId: 'id-1', stepId: 'id-2', direction: 'up' }, makeEnv()).error?.kind).toBe('cannot-move');
    expect(reduce(s, { type: 'MoveStep', taskId: 'id-1', stepId: 'id-4', direction: 'down' }, makeEnv()).error?.kind).toBe('cannot-move');
  });

  it('删除：删完最后一步会回到灰色；删掉未完成的一步可能让剩下的全部完成而进入等待确认', () => {
    let s = run([
      { type: 'CreateTask', title: 'T' },
      { type: 'SetCriteria', taskId: 'id-1', criteria: 'c' },
      { type: 'AddStep', taskId: 'id-1', title: 'a' },
      { type: 'AddStep', taskId: 'id-1', title: 'b' },
      { type: 'ToggleStep', taskId: 'id-1', stepId: 'id-2' },
    ]);
    expect(isPendingConfirmation(s.tasks[0]!)).toBe(false);
    const r = reduce(s, { type: 'DeleteStep', taskId: 'id-1', stepId: 'id-3' }, makeEnv());
    expect(isPendingConfirmation(r.state.tasks[0]!)).toBe(true);
    expect(r.events.some((e) => e.type === 'PendingEntered')).toBe(true);
    s = reduce(r.state, { type: 'DeleteStep', taskId: 'id-1', stepId: 'id-2' }, makeEnv()).state;
    expect(evaluate(s.tasks[0]!)).toBe('gray');
  });
});

describe('确认完成', () => {
  it('属性 3 示例：未确认的 Task 从不是 gold；只有确认成功后才进入 archive', () => {
    const { store, id } = pendingStore();
    expect(evaluate(store.getState().tasks[0]!)).toBe('green');
    expect(store.getState().archive).toHaveLength(0);
    expect(store.dispatch({ type: 'BeginConfirm', taskId: id }).error).toBeUndefined();
    expect(store.getState().archive).toHaveLength(0);
    expect(store.dispatch({ type: 'ConfirmComplete', taskId: id, memo: '' }).error).toBeUndefined();
    const s = store.getState();
    expect(s.tasks).toHaveLength(0);
    expect(s.archive).toHaveLength(1);
    expect(s.archive[0]).toMatchObject({ title: 'Tidy the desk', titleVisible: false, completedOn: '2026-11-08', stepCount: 3, memo: '' });
    expect(s.house.completedCount).toBe(1);
  });

  it('BeginConfirm 只对“全部完成”的 Task 有效', () => {
    const s = run([{ type: 'CreateTask', title: 'T' }]);
    expect(reduce(s, { type: 'BeginConfirm', taskId: 'id-1' }, makeEnv()).error?.kind).toBe('not-pending');
    expect(reduce(s, { type: 'ConfirmComplete', taskId: 'id-1', memo: '' }, makeEnv()).error?.kind).toBe('not-pending');
  });

  it('回归：完成条件为空而步骤全勾时 BeginConfirm / ConfirmComplete 都是 not-pending，补上完成条件后立即可确认', () => {
    let s = run([
      { type: 'CreateTask', title: 'T' },
      { type: 'AddStep', taskId: 'id-1', title: 'a' },
    ]);
    const sid = s.tasks[0]!.steps[0]!.id;
    s = reduce(s, { type: 'ToggleStep', taskId: 'id-1', stepId: sid }, makeEnv()).state;
    expect(isPendingConfirmation(s.tasks[0]!)).toBe(false);
    expect(evaluate(s.tasks[0]!)).toBe('gray');
    expect(reduce(s, { type: 'BeginConfirm', taskId: 'id-1' }, makeEnv()).error?.kind).toBe('not-pending');
    expect(reduce(s, { type: 'ConfirmComplete', taskId: 'id-1', memo: '' }, makeEnv()).error?.kind).toBe('not-pending');
    const saved = reduce(s, { type: 'SetCriteria', taskId: 'id-1', criteria: 'Clear' }, makeEnv());
    expect(evaluate(saved.state.tasks[0]!)).toBe('green');
    expect(isPendingConfirmation(saved.state.tasks[0]!)).toBe(true);
    expect(saved.events.some((e) => e.type === 'PendingEntered')).toBe(true);
    expect(reduce(saved.state, { type: 'BeginConfirm', taskId: 'id-1' }, makeEnv()).error).toBeUndefined();
  });

  it('留言 0–140 字：140 可以，141 被拒，可留空', () => {
    const { store, id } = pendingStore();
    store.dispatch({ type: 'BeginConfirm', taskId: id });
    const before = store.getState();
    const r = store.dispatch({ type: 'ConfirmComplete', taskId: id, memo: 'x'.repeat(141) });
    expect(r.error).toMatchObject({ kind: 'memo-too-long', length: 141, max: 140 });
    expect(store.getState()).toBe(before);
    expect(store.dispatch({ type: 'ConfirmComplete', taskId: id, memo: '好'.repeat(140) }).error).toBeUndefined();
    expect(store.getState().archive[0]!.memo).toHaveLength(140);
  });

  it('不在确认对话框里，或对象不是正在确认的那只：忽略', () => {
    const { store, id } = pendingStore();
    const before = store.getState();
    expect(store.dispatch({ type: 'ConfirmComplete', taskId: id, memo: '' }).error?.kind).toBe('not-confirming');
    store.dispatch({ type: 'BeginConfirm', taskId: id });
    store.dispatch({ type: 'CancelConfirm', taskId: id });
    expect(store.dispatch({ type: 'ConfirmComplete', taskId: id, memo: '' }).error?.kind).toBe('not-confirming');
    expect(store.getState()).toBe(before);
  });

  it('属性 15 示例：写入或回读失败 → 回滚，没有动画事件，可重试', () => {
    const modes: InjectedFailure[] = ['write-throws', 'readback-throws', 'readback-null', 'readback-differs'];
    for (const mode of modes) {
      const { store, id, port } = pendingStore();
      const events: string[] = [];
      store.subscribeEvents((e) => events.push(...e.map((x) => x.type)));
      store.dispatch({ type: 'BeginConfirm', taskId: id });
      const before = store.getState();
      port.failWith(mode);
      const r = store.dispatch({ type: 'ConfirmComplete', taskId: id, memo: 'hi' });
      expect(r.error?.kind).toBe('save-failed');
      expect(store.getState()).toBe(before);
      expect(events).toEqual([]);
      expect(store.flow.getState().confirmingId).toBe(id);
      // 重试
      port.failWith(null);
      expect(store.dispatch({ type: 'ConfirmComplete', taskId: id, memo: 'hi' }).error).toBeUndefined();
      expect(events).toContain('Confirmed');
      expect(store.getState().archive).toHaveLength(1);
      expect(store.flow.getState().confirmingId).toBeNull();
    }
  });

  it('成功时先写入再读回，写入内容就是新状态；确认后重复确认被拒', () => {
    const { store, id, port } = pendingStore();
    store.dispatch({ type: 'BeginConfirm', taskId: id });
    store.dispatch({ type: 'ConfirmComplete', taskId: id, memo: '' });
    expect(port.writes).toHaveLength(1);
    expect(JSON.parse(port.writes[0]!).archive).toHaveLength(1);
    const after = store.getState();
    expect(store.dispatch({ type: 'ConfirmComplete', taskId: id, memo: '' }).error).toBeDefined();
    expect(store.getState()).toBe(after);
  });

  it('属性 15 示例：已确认的 Task 只读——编辑动作一律被拒、state 不变', () => {
    const { store, id } = pendingStore();
    const stepId = store.getState().tasks[0]!.steps[0]!.id;
    store.dispatch({ type: 'BeginConfirm', taskId: id });
    store.dispatch({ type: 'ConfirmComplete', taskId: id, memo: '' });
    const after = store.getState();
    const attempts: Action[] = [
      { type: 'SetCriteria', taskId: id, criteria: 'new' },
      { type: 'AddStep', taskId: id, title: 'x' },
      { type: 'EditStep', taskId: id, stepId, title: 'x' },
      { type: 'DeleteStep', taskId: id, stepId },
      { type: 'MoveStep', taskId: id, stepId, direction: 'down' },
      { type: 'ToggleStep', taskId: id, stepId },
    ];
    for (const a of attempts) {
      const r = store.dispatch(a);
      expect(r.error?.kind).toBe('not-found');
      expect(store.getState()).toBe(after);
    }
  });

  it('属性 21 示例：确认只腾出自己的 Slot，室友与楼层不变', () => {
    const env = makeEnv();
    let s = run([{ type: 'CreateTask', title: 'a' }, { type: 'CreateTask', title: 'b' }, { type: 'CreateTask', title: 'c' }], env);
    const first = s.tasks[0]!;
    for (const a of [
      { type: 'SetCriteria', taskId: first.id, criteria: 'c' },
      { type: 'AddStep', taskId: first.id, title: 's' },
    ] as Action[]) s = reduce(s, a, env).state;
    s = reduce(s, { type: 'ToggleStep', taskId: first.id, stepId: s.tasks[0]!.steps[0]!.id }, env).state;
    const others = s.tasks.slice(1);
    const r = reduce(s, { type: 'ConfirmComplete', taskId: first.id, memo: '' }, env);
    expect(r.state.tasks).toEqual(others);
    expect(r.state.house.grownFloors).toBe(s.house.grownFloors);
    // 腾出的 Slot 立刻可被下一位使用
    const next = reduce(r.state, { type: 'CreateTask', title: 'd' }, env).state;
    expect(next.tasks.at(-1)!.slot).toEqual(first.slot);
  });
});

describe('暖灯', () => {
  it('属性 9 示例：lampsFor = min(12, n)，每次确认 +1，WarmLampAdded 只在增加时发出', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 1000 }), (n) => {
      expect(lampsFor(n)).toBe(Math.min(12, n));
    }));
    const env = makeEnv();
    let s = emptyState();
    const added: number[] = [];
    for (let i = 1; i <= 14; i++) {
      s = run([{ type: 'CreateTask', title: `t${i}` }], env, s);
      const t = s.tasks.at(-1)!;
      s = run(
        [
          { type: 'SetCriteria', taskId: t.id, criteria: 'c' },
          { type: 'AddStep', taskId: t.id, title: 's' },
        ],
        env,
        s,
      );
      s = reduce(s, { type: 'ToggleStep', taskId: t.id, stepId: s.tasks.at(-1)!.steps[0]!.id }, env).state;
      const r = reduce(s, { type: 'ConfirmComplete', taskId: t.id, memo: '' }, env);
      s = r.state;
      for (const e of r.events) if (e.type === 'WarmLampAdded') added.push(e.n);
      expect(s.house.completedCount).toBe(i);
    }
    expect(added).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});

describe('aria-live 播报', () => {
  it('勾选播报家务与进度；取消播报温柔文案与回退进度；等确认单独播报', () => {
    const env = makeEnv();
    const store = createStore({ env });
    store.dispatch({ type: 'CreateTask', title: 'T' });
    const id = store.getState().tasks[0]!.id;
    store.dispatch({ type: 'SetCriteria', taskId: id, criteria: 'c' });
    store.dispatch({ type: 'AddStep', taskId: id, title: 'a' });
    store.dispatch({ type: 'AddStep', taskId: id, title: 'b' });
    const [a, b] = store.getState().tasks[0]!.steps;
    const say = (action: Action) => announce(store.dispatch(action).events, store.getState());
    expect(say({ type: 'ToggleStep', taskId: id, stepId: a!.id })).toBe('Swept the floor. 1 of 2 done. Now: In progress.');
    expect(say({ type: 'ToggleStep', taskId: id, stepId: b!.id })).toBe('Watered the plants. 2 of 2 done. Now: Ready to confirm.');
    expect(say({ type: 'ToggleStep', taskId: id, stepId: b!.id })).toBe('Oops, let me fix that. 1 of 2 done.');
    expect(say({ type: 'ToggleStep', taskId: id, stepId: a!.id })).toBe('Oops, let me fix that. 0 of 2 done. Now: Ready to start.');
  });
});

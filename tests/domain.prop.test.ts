import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { evaluate, isClarified, isPendingConfirmation } from '../src/domain/evaluate';
import { choreFor, progress } from '../src/domain/progress';
import { reduce } from '../src/domain/reducer';
import { allocate, floorsNeeded, slotKey } from '../src/domain/slots';
import { emptyState, type Action, type AppState, type Env, type Step, type Task } from '../src/domain/types';

function makeEnv(): Env {
  let n = 0;
  return { now: () => '2026-01-01T00:00:00.000Z', today: () => '2026-01-01', newId: () => `id-${++n}` };
}

const stepArb = fc.record({ id: fc.uuid(), title: fc.string({ minLength: 1, maxLength: 10 }), done: fc.boolean() });
const taskArb: fc.Arbitrary<Task> = fc.record({
  id: fc.uuid(),
  ghostNo: fc.nat(),
  title: fc.string({ minLength: 1, maxLength: 20 }),
  criteria: fc.string({ maxLength: 20 }),
  steps: fc.array(stepArb, { maxLength: 8 }),
  slot: fc.constant({ floor: 2 as const, slot: 0 as const }),
  createdAt: fc.constant('2026-01-01T00:00:00.000Z'),
});

const step = (done: boolean): Step => ({ id: Math.random().toString(), title: 's', done });

describe('判定表（四行里的三行；gold 只在确认后，见阶段 5）', () => {
  const t = (criteria: string, steps: Step[]) => ({ criteria, steps });
  it('未 Clarified → gray', () => {
    expect(evaluate(t('', []))).toBe('gray');
    expect(evaluate(t('done', []))).toBe('gray');
    expect(evaluate(t('', [step(false)]))).toBe('gray');
    expect(evaluate(t('   \u3000', [step(true)]))).toBe('gray');
  });
  it('Clarified 且 0 步完成 → white', () => {
    expect(evaluate(t('x', [step(false), step(false)]))).toBe('white');
  });
  it('Clarified 且至少 1 步完成 → green，全部完成仍为 green 并 pending', () => {
    expect(evaluate(t('x', [step(true), step(false)]))).toBe('green');
    const all = t('x', [step(true), step(true)]);
    expect(evaluate(all)).toBe('green');
    expect(isPendingConfirmation(all)).toBe(true);
    expect(isPendingConfirmation(t('x', [step(true), step(false)]))).toBe(false);
    expect(isPendingConfirmation(t('x', []))).toBe(false);
    expect(isClarified(t('x', [step(false)]))).toBe(true);
  });
  it('回归：完成条件为空（含全空白）而步骤全勾 → gray，且不是 pending', () => {
    for (const criteria of ['', '   \u3000']) {
      const all = t(criteria, [step(true), step(true)]);
      expect(evaluate(all)).toBe('gray');
      expect(isPendingConfirmation(all)).toBe(false);
    }
  });
  it('属性：pending 蕴含 Clarified 与 green', () => {
    fc.assert(
      fc.property(taskArb, (task) => {
        if (isPendingConfirmation(task)) {
          expect(isClarified(task)).toBe(true);
          expect(evaluate(task)).toBe('green');
        }
      }),
    );
  });
});

describe('Feature: unfinished-business, Property 1: evaluate 确定且与时间无关', () => {
  it('同一数据多次、在不同时间求值结果相同', () => {
    fc.assert(
      fc.property(taskArb, fc.date(), fc.date(), (task, d1, d2) => {
        const a = evaluate(task);
        const realNow = Date.now;
        Date.now = () => d1.getTime();
        const b = evaluate(task);
        Date.now = () => d2.getTime();
        const c = evaluate(task);
        Date.now = realNow;
        expect(b).toBe(a);
        expect(c).toBe(a);
        expect(['gray', 'white', 'green']).toContain(a);
      }),
      { numRuns: 100 },
    );
  });
});

describe('Feature: unfinished-business, Property 4: Progress 范围', () => {
  it('done / total / ratio 正确', () => {
    fc.assert(
      fc.property(taskArb, (task) => {
        const p = progress(task);
        expect(p.done).toBe(task.steps.filter((s) => s.done).length);
        expect(p.total).toBe(task.steps.length);
        expect(p.ratio).toBeGreaterThanOrEqual(0);
        expect(p.ratio).toBeLessThanOrEqual(1);
        if (p.total === 0) expect(p.ratio).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});

describe('Feature: unfinished-business, Property 5: Chore 分配', () => {
  it('choreFor(i) = [sweep, water, window][i mod 3]', () => {
    fc.assert(
      fc.property(fc.nat(100000), (i) => {
        expect(choreFor(i)).toBe((['sweep', 'water', 'window'] as const)[i % 3]);
      }),
      { numRuns: 100 },
    );
  });
  it('勾选第 i 个步骤恰产生一个 StepChecked，chore 对应', () => {
    const env = makeEnv();
    let s = reduce(emptyState(), { type: 'CreateTask', title: 'a' }, env).state;
    const id = s.tasks[0]!.id;
    for (let i = 0; i < 5; i++) s = reduce(s, { type: 'AddStep', taskId: id, title: `s${i}` }, env).state;
    s.tasks[0]!.steps.forEach((st, i) => {
      const r = reduce(s, { type: 'ToggleStep', taskId: id, stepId: st.id }, env);
      const checked = r.events.filter((e) => e.type === 'StepChecked');
      expect(checked).toHaveLength(1);
      expect(checked[0]).toMatchObject({ chore: choreFor(i) });
    });
  });
});

describe('reducer：创建、澄清、勾选', () => {
  const env = makeEnv();
  it('创建：灰色、二楼左、事件 GhostMovedIn、标题 trim', () => {
    const r = reduce(emptyState(), { type: 'CreateTask', title: '  Pay rent \u3000' }, env);
    expect(r.error).toBeUndefined();
    expect(r.state.tasks).toHaveLength(1);
    const t = r.state.tasks[0]!;
    expect(t.title).toBe('Pay rent');
    expect(t.slot).toEqual({ floor: 2, slot: 0 });
    expect(evaluate(t)).toBe('gray');
    expect(r.events).toEqual([{ type: 'GhostMovedIn', taskId: t.id, slot: t.slot }]);
    expect(r.state.nextGhostNo).toBe(2);
  });

  it('非法输入被拒，state 引用不变', () => {
    const s = emptyState();
    for (const title of ['', '   ', 'x'.repeat(81)]) {
      const r = reduce(s, { type: 'CreateTask', title }, env);
      expect(r.state).toBe(s);
      expect(r.error).toBeDefined();
      expect(r.events).toEqual([]);
    }
  });

  it('条件 + 步骤 → 变白，产生 ClarifiedTransition；仅其一时仍灰', () => {
    let s = reduce(emptyState(), { type: 'CreateTask', title: 'a' }, env).state;
    const id = s.tasks[0]!.id;
    let r = reduce(s, { type: 'SetCriteria', taskId: id, criteria: 'ok' }, env);
    expect(evaluate(r.state.tasks[0]!)).toBe('gray');
    expect(r.events).toEqual([]);
    s = r.state;
    r = reduce(s, { type: 'AddStep', taskId: id, title: 'one' }, env);
    expect(evaluate(r.state.tasks[0]!)).toBe('white');
    expect(r.events.map((e) => e.type)).toEqual(['StateChanged', 'ClarifiedTransition']);
  });

  it('超长条件、第 51 个步骤、未知 id 均被拒且 state 引用不变', () => {
    let s = reduce(emptyState(), { type: 'CreateTask', title: 'a' }, env).state;
    const id = s.tasks[0]!.id;
    const bad = (a: Action) => {
      const r = reduce(s, a, env);
      expect(r.state).toBe(s);
      expect(r.error).toBeDefined();
    };
    bad({ type: 'SetCriteria', taskId: id, criteria: 'x'.repeat(201) });
    bad({ type: 'SetCriteria', taskId: 'nope', criteria: '' });
    bad({ type: 'AddStep', taskId: id, title: ' ' });
    bad({ type: 'ToggleStep', taskId: id, stepId: 'nope' });
    for (let i = 0; i < 50; i++) s = reduce(s, { type: 'AddStep', taskId: id, title: `s${i}` }, env).state;
    bad({ type: 'AddStep', taskId: id, title: 'one too many' });
  });

  it('全部完成 → PendingEntered，仍为 green，取消后离开 pending', () => {
    let s = reduce(emptyState(), { type: 'CreateTask', title: 'a' }, env).state;
    const id = s.tasks[0]!.id;
    s = reduce(s, { type: 'SetCriteria', taskId: id, criteria: 'c' }, env).state;
    s = reduce(s, { type: 'AddStep', taskId: id, title: 'one' }, env).state;
    const sid = s.tasks[0]!.steps[0]!.id;
    const on = reduce(s, { type: 'ToggleStep', taskId: id, stepId: sid }, env);
    expect(on.events.map((e) => e.type)).toEqual(['StepChecked', 'StateChanged', 'PendingEntered']);
    expect(evaluate(on.state.tasks[0]!)).toBe('green');
    const off = reduce(on.state, { type: 'ToggleStep', taskId: id, stepId: sid }, env);
    expect(off.events.map((e) => e.type)).toEqual(['EraserScribble', 'StateChanged']);
    expect(isPendingConfirmation(off.state.tasks[0]!)).toBe(false);
  });
});

describe('Feature: unfinished-business, Property 2: 勾选再取消往返', () => {
  it('连续两次 ToggleStep 后数据、状态与进度不变', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }),
        fc.string({ maxLength: 10 }),
        fc.nat(),
        (dones, criteria, pick) => {
          const env = makeEnv();
          let s = reduce(emptyState(), { type: 'CreateTask', title: 't' }, env).state;
          const id = s.tasks[0]!.id;
          s = reduce(s, { type: 'SetCriteria', taskId: id, criteria }, env).state;
          for (let i = 0; i < dones.length; i++) s = reduce(s, { type: 'AddStep', taskId: id, title: `s${i}` }, env).state;
          for (const [i, d] of dones.entries()) {
            if (d) s = reduce(s, { type: 'ToggleStep', taskId: id, stepId: s.tasks[0]!.steps[i]!.id }, env).state;
          }
          const sid = s.tasks[0]!.steps[pick % dones.length]!.id;
          const once = reduce(s, { type: 'ToggleStep', taskId: id, stepId: sid }, env).state;
          const twice = reduce(once, { type: 'ToggleStep', taskId: id, stepId: sid }, env).state;
          expect(twice.tasks).toEqual(s.tasks);
          expect(evaluate(twice.tasks[0]!)).toBe(evaluate(s.tasks[0]!));
          expect(progress(twice.tasks[0]!)).toEqual(progress(s.tasks[0]!));
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('槽位与楼层（属性 7 / 8 的示例补充）', () => {
  const opArb = fc.constantFrom('create', 'create', 'create', 'bad') as fc.Arbitrary<'create' | 'bad'>;

  it('Slot 不重复、不超过 10，满员拒绝；allocate 取最低楼层最小 slot', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 30 }), (ops) => {
        const env = makeEnv();
        let s: AppState = emptyState();
        for (const op of ops) {
          const r = reduce(s, { type: 'CreateTask', title: op === 'bad' ? '' : 'x' }, env);
          if (s.tasks.length >= 10 && op === 'create') {
            expect(r.error).toEqual({ kind: 'house-full' });
            expect(r.state).toBe(s);
          }
          s = r.state;
          const keys = s.tasks.map((t) => slotKey(t.slot));
          expect(new Set(keys).size).toBe(keys.length);
          expect(keys.length).toBeLessThanOrEqual(10);
        }
        const occupied = new Set(s.tasks.map((t) => slotKey(t.slot)));
        const next = allocate(occupied);
        if (s.tasks.length >= 10) expect(next).toBeNull();
        else expect(next).toEqual({ floor: 2 + Math.floor(s.tasks.length / 2), slot: s.tasks.length % 2 });
      }),
      { numRuns: 100 },
    );
  });

  it('grownFloors 单调，第 3/5/7/9 只入住时增至 3/4/5/6，前两只在二楼', () => {
    const env = makeEnv();
    let s: AppState = emptyState();
    let prev = s.house.grownFloors;
    const expected: Record<number, number> = { 1: 2, 2: 2, 3: 3, 4: 3, 5: 4, 6: 4, 7: 5, 8: 5, 9: 6, 10: 6 };
    for (let n = 1; n <= 10; n++) {
      const r = reduce(s, { type: 'CreateTask', title: `t${n}` }, env);
      s = r.state;
      expect(s.house.grownFloors).toBeGreaterThanOrEqual(prev);
      expect(s.house.grownFloors).toBe(expected[n]);
      expect(s.house.grownFloors).toBeGreaterThanOrEqual(floorsNeeded(n));
      for (const t of s.tasks) expect(t.slot.floor).toBeLessThanOrEqual(s.house.grownFloors);
      const grew = r.events.some((e) => e.type === 'FloorGrown');
      expect(grew).toBe(s.house.grownFloors > prev);
      prev = s.house.grownFloors;
    }
    expect(s.tasks.slice(0, 2).map((t) => t.slot.floor)).toEqual([2, 2]);
    expect(floorsNeeded(3)).toBe(3);
    expect(floorsNeeded(5)).toBe(4);
    expect(floorsNeeded(7)).toBe(5);
    expect(floorsNeeded(9)).toBe(6);
  });
});

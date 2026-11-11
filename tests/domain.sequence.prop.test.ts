import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { evaluate, isPendingConfirmation } from '../src/domain/evaluate';
import { lampsFor } from '../src/domain/house';
import { reduce } from '../src/domain/reducer';
import { allocate, floorsNeeded, MAX_RESIDENTS, slotKey } from '../src/domain/slots';
import type { Action, AppState } from '../src/domain/types';
import { createStore } from '../src/store/store';
import { createMemoryPort, type InjectedFailure } from '../src/store/storagePort';
import { opsArb, runOps, sequenceEnv, toPending } from './helpers/sequence';

// 领域层的“任意合法操作序列”属性：创建、补条件、加步骤、勾选、确认、安静搬走的随机组合。

const occupied = (s: AppState) => new Set(s.tasks.map((t) => slotKey(t.slot)));

describe('Feature: unfinished-business, Property 3: 仅确认后 Gold', () => {
  it('未确认的 Task 从不是 gold；全部完成的未确认 Task 是 green 且等待确认；只有确认成功才进入 archive', () => {
    fc.assert(
      fc.property(opsArb, (ops) => {
        runOps(ops, (a) => {
          for (const t of a.after.tasks) {
            expect(evaluate(t)).not.toBe('gold');
            const allDone = t.steps.length > 0 && t.steps.every((s) => s.done) && t.criteria.trim().length > 0;
            if (allDone) {
              expect(evaluate(t)).toBe('green');
              expect(isPendingConfirmation(t)).toBe(true);
            }
          }
          const grew = a.after.archive.length - a.before.archive.length;
          expect(grew).toBe(a.confirmed ? 1 : 0);
          if (a.confirmed) expect(a.after.tasks.some((t) => t.id === a.target!.id)).toBe(false);
        });
      }),
      { numRuns: 100 },
    );
  });
});

describe('Feature: unfinished-business, Property 7: Slot 分配安全', () => {
  it('占用数不超过 10，未确认 Task 的 Slot 互不相同；allocate 给出最低楼层最小 slot；满员时创建被拒且 state 不变', () => {
    fc.assert(
      fc.property(opsArb, (ops) => {
        runOps(ops, (a) => {
          const keys = a.after.tasks.map((t) => slotKey(t.slot));
          expect(new Set(keys).size).toBe(keys.length);
          expect(keys.length).toBeLessThanOrEqual(MAX_RESIDENTS);
          if (a.op.k === 'create') {
            const expected = allocate(occupied(a.before));
            if (expected === null) {
              expect(a.error).toEqual({ kind: 'house-full' });
              expect(a.after).toBe(a.before);
            } else {
              expect(a.after.tasks.at(-1)!.slot).toEqual(expected);
            }
          }
        });
      }),
      { numRuns: 100 },
    );
  });
});

describe('Feature: unfinished-business, Property 8: 楼层增长单调', () => {
  it('grownFloors 不减、不小于所需楼层、任何 Task 的楼层不超过它；占用数首次到 3/5/7/9 时增至 3/4/5/6', () => {
    fc.assert(
      fc.property(opsArb, (ops) => {
        let peak = 0;
        runOps(ops, (a) => {
          expect(a.after.house.grownFloors).toBeGreaterThanOrEqual(a.before.house.grownFloors);
          expect(a.after.house.grownFloors).toBeGreaterThanOrEqual(floorsNeeded(a.after.tasks.length));
          for (const t of a.after.tasks) expect(t.slot.floor).toBeLessThanOrEqual(a.after.house.grownFloors);
          peak = Math.max(peak, a.after.tasks.length);
          expect(a.after.house.grownFloors).toBe(Math.max(2, floorsNeeded(peak)));
          expect([0, 1].includes(a.after.house.grownFloors - a.before.house.grownFloors)).toBe(true);
          // 还停在二楼的时候，所有人都在二楼
          if (a.after.house.grownFloors === 2) for (const t of a.after.tasks) expect(t.slot.floor).toBe(2);
        });
        // 首次达到 3、5、7、9 只
        expect([floorsNeeded(3), floorsNeeded(5), floorsNeeded(7), floorsNeeded(9)]).toEqual([3, 4, 5, 6]);
      }),
      { numRuns: 100 },
    );
  });
});

describe('Feature: unfinished-business, Property 9: Warm_Lamp 单调且有上限', () => {
  it('completedCount 与灯数不减、灯数 = min(12, 累计确认数)；删除不改计数也不产生 WarmLampAdded', () => {
    fc.assert(
      fc.property(opsArb, (ops) => {
        let confirms = 0;
        runOps(ops, (a) => {
          if (a.confirmed) confirms += 1;
          const { completedCount } = a.after.house;
          expect(completedCount).toBeGreaterThanOrEqual(a.before.house.completedCount);
          expect(completedCount).toBe(confirms);
          expect(lampsFor(completedCount)).toBe(Math.min(12, confirms));
          expect(lampsFor(completedCount)).toBeGreaterThanOrEqual(lampsFor(a.before.house.completedCount));
          expect(lampsFor(completedCount)).toBeLessThanOrEqual(12);
          const added = a.events.filter((e) => e.type === 'WarmLampAdded');
          if (a.op.k === 'delete' || a.op.k === 'ghost-delete') {
            expect(completedCount).toBe(a.before.house.completedCount);
            expect(added).toEqual([]);
          }
          expect(added).toHaveLength(a.confirmed && completedCount <= 12 ? 1 : 0);
        });
      }),
      { numRuns: 100 },
    );
  });
});

describe('Feature: unfinished-business, Property 14: 删除不产生纪念', () => {
  it('DeleteTask 之后 archive 不变，该 Task 的 Slot 被腾空', () => {
    fc.assert(
      fc.property(opsArb, (ops) => {
        runOps(ops, (a) => {
          if (a.op.k !== 'delete' || !a.target) return;
          expect(a.error).toBeUndefined();
          expect(a.after.archive).toBe(a.before.archive);
          expect(a.after.house.completedCount).toBe(a.before.house.completedCount);
          expect(occupied(a.after).has(slotKey(a.target.slot))).toBe(false);
          expect(a.after.tasks.some((t) => t.id === a.target!.id)).toBe(false);
        });
      }),
      { numRuns: 100 },
    );
  });
});

describe('Feature: unfinished-business, Property 15: 确认后只读与失败回滚', () => {
  const modeArb = fc.constantFrom<InjectedFailure>('write-throws', 'readback-throws', 'readback-null', 'readback-differs');
  const editsOf = (id: string, stepId: string): Action[] => [
    { type: 'SetCriteria', taskId: id, criteria: 'new' },
    { type: 'AddStep', taskId: id, title: 'x' },
    { type: 'EditStep', taskId: id, stepId, title: 'x' },
    { type: 'DeleteStep', taskId: id, stepId },
    { type: 'MoveStep', taskId: id, stepId, direction: 'down' },
    { type: 'ToggleStep', taskId: id, stepId },
  ];

  it('已进入 archive 的任务，编辑类动作一律被拒且 state 不变；写入或读回失败时确认回滚、没有动画事件、可重试', () => {
    fc.assert(
      fc.property(opsArb, modeArb, (ops, mode) => {
        const env = sequenceEnv();
        const confirmedIds: { id: string; stepId: string }[] = [];
        const end = runOps(
          ops,
          (a) => {
            if (a.confirmed) confirmedIds.push({ id: a.target!.id, stepId: toPending(a.before, a.target!.id, env).tasks.find((t) => t.id === a.target!.id)!.steps[0]!.id });
          },
          env,
        );
        for (const { id, stepId } of confirmedIds) {
          for (const action of editsOf(id, stepId)) {
            const r = reduce(end, action, env);
            expect(r.error).toBeDefined();
            expect(r.state).toBe(end);
            expect(r.events).toEqual([]);
          }
        }

        // 注入写入失败：确认回滚
        const port = createMemoryPort();
        const store = createStore({ env: sequenceEnv(), port });
        store.dispatch({ type: 'CreateTask', title: 'Tidy' });
        const id = store.getState().tasks[0]!.id;
        store.dispatch({ type: 'SetCriteria', taskId: id, criteria: 'Clear' });
        store.dispatch({ type: 'AddStep', taskId: id, title: 's' });
        store.dispatch({ type: 'ToggleStep', taskId: id, stepId: store.getState().tasks[0]!.steps[0]!.id });
        store.dispatch({ type: 'BeginConfirm', taskId: id });
        const events: string[] = [];
        store.subscribeEvents((e) => events.push(...e.map((x) => x.type)));
        const before = store.getState();
        port.failWith(mode);
        const r = store.dispatch({ type: 'ConfirmComplete', taskId: id, memo: '' });
        expect(r.error?.kind).toBe('save-failed');
        expect(store.getState()).toBe(before);
        expect(events).toEqual([]);
        port.failWith(null);
        expect(store.dispatch({ type: 'ConfirmComplete', taskId: id, memo: '' }).error).toBeUndefined();
        expect(events).toContain('Confirmed');
      }),
      { numRuns: 100 },
    );
  });
});

describe('Feature: unfinished-business, Property 21: 离开只腾自己的 Slot', () => {
  it('任一次确认或删除之后，只有被操作 Task 的 Slot 被移出占用集合；其余 Task 的引用与判定不变；grownFloors 不减', () => {
    fc.assert(
      fc.property(opsArb, (ops) => {
        runOps(ops, (a) => {
          if (!(a.confirmed || (a.op.k === 'delete' && a.target && !a.error))) return;
          const target = a.target!;
          // 确认前，任务可能先被补条件、勾选；这些改动只落在它自己身上，所以比较“除它以外”的任务。
          const rest = a.before.tasks.filter((t) => t.id !== target.id);
          expect(a.after.tasks).toHaveLength(rest.length);
          a.after.tasks.forEach((t, k) => {
            expect(t).toBe(rest[k]);
            expect(evaluate(t)).toBe(evaluate(rest[k]!));
          });
          const was = occupied(a.before);
          const now = occupied(a.after);
          expect([...was].filter((k) => !now.has(k))).toEqual([slotKey(target.slot)]);
          expect(a.after.house.grownFloors).toBeGreaterThanOrEqual(a.before.house.grownFloors);
        });
      }),
      { numRuns: 100 },
    );
  });
});

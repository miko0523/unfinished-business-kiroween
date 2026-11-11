import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { evaluate } from '../src/domain/evaluate';
import { reduce } from '../src/domain/reducer';
import { allocate, floorsNeeded, MAX_RESIDENTS, slotKey } from '../src/domain/slots';
import { emptyState, type Action, type AppState, type Env } from '../src/domain/types';
import { announce } from '../src/store/announce';
import { createStore } from '../src/store/store';

function makeEnv(): Env {
  let n = 0;
  return { now: () => '2026-11-08T09:00:00.000Z', today: () => '2026-11-08', newId: () => `id-${++n}` };
}

/** 把一只 Task 推到“等待确认”：补完成条件、加一步并勾上。 */
function toPending(s: AppState, id: string, env: Env): AppState {
  let next = reduce(s, { type: 'SetCriteria', taskId: id, criteria: 'Tidy' }, env).state;
  next = reduce(next, { type: 'AddStep', taskId: id, title: 'one' }, env).state;
  const stepId = next.tasks.find((t) => t.id === id)!.steps[0]!.id;
  return reduce(next, { type: 'ToggleStep', taskId: id, stepId }, env).state;
}

type Op = { k: 'create' } | { k: 'delete'; i: number } | { k: 'confirm'; i: number } | { k: 'ghost-delete' };
const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 5, arbitrary: fc.constant<Op>({ k: 'create' }) },
  { weight: 3, arbitrary: fc.nat(20).map<Op>((i) => ({ k: 'delete', i })) },
  { weight: 2, arbitrary: fc.nat(20).map<Op>((i) => ({ k: 'confirm', i })) },
  { weight: 1, arbitrary: fc.constant<Op>({ k: 'ghost-delete' }) },
);

const occupied = (s: AppState) => new Set(s.tasks.map((t) => slotKey(t.slot)));

describe('创建、确认、删除的任意序列（属性 7 / 8 / 14 / 21 的组合检查）', () => {
  it('占用不超过 10 且互不相同；allocate 取最低空位；楼层只升不降；离开只腾自己的 Slot；删除不产生纪念', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 60 }), (ops) => {
        const env = makeEnv();
        let s: AppState = emptyState();
        for (const op of ops) {
          const before = s;
          const floorsBefore = before.house.grownFloors;
          if (op.k === 'create') {
            const expected = allocate(occupied(before));
            const r = reduce(before, { type: 'CreateTask', title: 'x' }, env);
            if (expected === null) {
              expect(r.error).toEqual({ kind: 'house-full' });
              expect(r.state).toBe(before);
              expect(r.events).toEqual([]);
            } else {
              expect(r.error).toBeUndefined();
              expect(r.state.tasks.at(-1)!.slot).toEqual(expected);
              expect(r.state.tasks.slice(0, -1)).toEqual(before.tasks);
            }
            s = r.state;
          } else if (op.k === 'ghost-delete') {
            const r = reduce(before, { type: 'DeleteTask', taskId: 'nobody' }, env);
            expect(r.error).toEqual({ kind: 'not-found' });
            expect(r.state).toBe(before);
            expect(r.events).toEqual([]);
          } else if (before.tasks.length > 0) {
            const target = before.tasks[op.i % before.tasks.length]!;
            if (op.k === 'confirm') {
              s = toPending(before, target.id, env);
              s = reduce(s, { type: 'ConfirmComplete', taskId: target.id, memo: '' }, env).state;
              expect(s.archive).toHaveLength(before.archive.length + 1);
            } else {
              const r = reduce(before, { type: 'DeleteTask', taskId: target.id }, env);
              expect(r.error).toBeUndefined();
              // P14：不写入纪念册，也不碰暖灯与房子
              expect(r.state.archive).toBe(before.archive);
              expect(r.state.house).toBe(before.house);
              expect(r.state.settings).toBe(before.settings);
              expect(r.events.map((e) => e.type)).toEqual(['MovedOutQuietly']);
              // 再删一次：已经不在了
              expect(reduce(r.state, { type: 'DeleteTask', taskId: target.id }, env).error).toEqual({ kind: 'not-found' });
              s = r.state;
            }
            // P21：只有它的 Slot 空出来；其余 Task 引用不变，状态不变
            const rest = before.tasks.filter((t) => t.id !== target.id);
            expect(s.tasks).toHaveLength(rest.length);
            s.tasks.forEach((t, k) => {
              expect(t).toBe(rest[k]);
              expect(evaluate(t)).toBe(evaluate(rest[k]!));
            });
            expect(occupied(s).has(slotKey(target.slot))).toBe(false);
            // 腾出的 Slot 立即可用：下一次分配不会比它更高
            const next = allocate(occupied(s))!;
            expect(next.floor * 2 + next.slot).toBeLessThanOrEqual(target.slot.floor * 2 + target.slot.slot);
          }
          // P7 / P8
          const keys = s.tasks.map((t) => slotKey(t.slot));
          expect(new Set(keys).size).toBe(keys.length);
          expect(keys.length).toBeLessThanOrEqual(MAX_RESIDENTS);
          expect(s.house.grownFloors).toBeGreaterThanOrEqual(floorsBefore);
          expect(s.house.grownFloors).toBeGreaterThanOrEqual(floorsNeeded(s.tasks.length));
          for (const t of s.tasks) expect(t.slot.floor).toBeLessThanOrEqual(s.house.grownFloors);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('删除不增加暖灯，也不增加完成计数', () => {
    const env = makeEnv();
    let s = reduce(emptyState(), { type: 'CreateTask', title: 'a' }, env).state;
    s = reduce(s, { type: 'CreateTask', title: 'b' }, env).state;
    const r = reduce(s, { type: 'DeleteTask', taskId: s.tasks[0]!.id }, env);
    expect(r.state.house.completedCount).toBe(0);
    expect(r.events.some((e) => e.type === 'WarmLampAdded')).toBe(false);
  });
});

describe('DeleteTask 的细节', () => {
  it('事件带着搬走时的样子（状态、进度比例、是否在等确认），玩家文字里没有内部编号', () => {
    const env = makeEnv();
    let s = reduce(emptyState(), { type: 'CreateTask', title: 'Water the plants' }, env).state;
    const id = s.tasks[0]!.id;
    s = toPending(s, id, env);
    const r = reduce(s, { type: 'DeleteTask', taskId: id }, env);
    expect(r.events).toEqual([
      { type: 'MovedOutQuietly', taskId: id, slot: { floor: 2, slot: 0 }, state: 'green', ratio: 1, pending: true },
    ]);
    const text = announce(r.events, r.state);
    expect(text).toBe('The little ghost packed its suitcase and moved out quietly.');
    expect(text).not.toMatch(/id-|give up|fail/i);
  });

  it('室友的数据逐字不变（引用相同），空出的 Slot 被下一只拿到', () => {
    const env = makeEnv();
    let s = emptyState();
    for (const title of ['a', 'b', 'c', 'd']) s = reduce(s, { type: 'CreateTask', title }, env).state;
    const gone = s.tasks[1]!;
    const r = reduce(s, { type: 'DeleteTask', taskId: gone.id }, env);
    expect(r.state.tasks).toEqual([s.tasks[0], s.tasks[2], s.tasks[3]]);
    const again = reduce(r.state, { type: 'CreateTask', title: 'e' }, env).state;
    expect(again.tasks.at(-1)!.slot).toEqual(gone.slot);
    expect(again.house.grownFloors).toBe(r.state.house.grownFloors);
  });

  it('楼层不塌回：删到只剩一两只，grownFloors 仍是最高值', () => {
    const env = makeEnv();
    let s = emptyState();
    for (let i = 0; i < 9; i++) s = reduce(s, { type: 'CreateTask', title: `t${i}` }, env).state;
    expect(s.house.grownFloors).toBe(6);
    while (s.tasks.length > 1) s = reduce(s, { type: 'DeleteTask', taskId: s.tasks[0]!.id }, env).state;
    expect(s.house.grownFloors).toBe(6);
  });
});

describe('store：DeleteTask 与确认流程、示例暂停', () => {
  it('删除正在确认的那只，确认流程一并收起', () => {
    const env = makeEnv();
    const store = createStore({ env });
    store.dispatch({ type: 'CreateTask', title: 'a' });
    const id = store.getState().tasks[0]!.id;
    for (const a of [
      { type: 'SetCriteria', taskId: id, criteria: 'ok' },
      { type: 'AddStep', taskId: id, title: 's' },
    ] as Action[]) store.dispatch(a);
    store.dispatch({ type: 'ToggleStep', taskId: id, stepId: store.getState().tasks[0]!.steps[0]!.id });
    expect(store.dispatch({ type: 'BeginConfirm', taskId: id }).error).toBeUndefined();
    expect(store.flow.getState().confirmingId).toBe(id);
    expect(store.dispatch({ type: 'DeleteTask', taskId: id }).error).toBeUndefined();
    expect(store.flow.getState().confirmingId).toBeNull();
    expect(store.getState().archive).toEqual([]);
  });

  it('示例暂停期间不收 DeleteTask', () => {
    const store = createStore({ env: makeEnv() });
    store.dispatch({ type: 'CreateTask', title: 'a' });
    const before = store.getState();
    store.freeze();
    const r = store.dispatch({ type: 'DeleteTask', taskId: before.tasks[0]!.id });
    expect(r.error).toEqual({ kind: 'paused' });
    expect(store.getState()).toBe(before);
  });

  it('事件只发给订阅者，且被拒绝的删除不发事件', () => {
    const store = createStore({ env: makeEnv() });
    store.dispatch({ type: 'CreateTask', title: 'a' });
    const seen: string[] = [];
    store.subscribeEvents((events) => events.forEach((e) => seen.push(e.type)));
    store.dispatch({ type: 'DeleteTask', taskId: 'nobody' });
    expect(seen).toEqual([]);
    store.dispatch({ type: 'DeleteTask', taskId: store.getState().tasks[0]!.id });
    expect(seen).toEqual(['MovedOutQuietly']);
  });
});

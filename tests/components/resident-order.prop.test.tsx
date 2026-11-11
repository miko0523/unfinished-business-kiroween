// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import fc from 'fast-check';
import { App } from '../../src/components/App';
import { residentOrder } from '../../src/house/order';
import { emptyState, type AppState, type Env, type FloorNo, type SideNo, type Task } from '../../src/domain/types';
import { createStore } from '../../src/store/store';
import { createUiStore } from '../../src/store/uiStore';

const env: Env = { now: () => '2026-11-09T08:00:00.000Z', today: () => '2026-11-09', newId: () => 'id-x' };

const ALL_SLOTS = ([2, 3, 4, 5, 6] as FloorNo[]).flatMap((floor) => ([0, 1] as SideNo[]).map((slot) => ({ floor, slot })));

/** 任意子集、任意先后顺序的住客集合（Task 在数组里的顺序与楼层无关）。 */
const tasksArb: fc.Arbitrary<Task[]> = fc
  .shuffledSubarray(ALL_SLOTS, { minLength: 0, maxLength: 10 })
  .chain((slots) => fc.shuffledSubarray(slots, { minLength: slots.length, maxLength: slots.length }))
  .map((slots) =>
    slots.map((slot, i) => ({ id: `t${i}`, ghostNo: i + 1, title: `Ghost ${i}`, criteria: '', steps: [], slot, createdAt: env.now() })),
  );

const stateOf = (tasks: Task[]): AppState => ({
  ...emptyState(),
  tasks,
  house: { grownFloors: Math.max(2, ...tasks.map((t) => t.slot.floor)) as FloorNo, completedCount: 0 },
  nextGhostNo: tasks.length + 1,
});

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('Feature: unfinished-business, Property 26: 聚焦顺序', () => {
  it('residentOrder 按楼层降序、同层 slot 升序且每个 Task 恰一次；渲染的 Ghost 按钮 DOM 顺序与其一致，每只只有一个按钮', () => {
    fc.assert(
      fc.property(tasksArb, (tasks) => {
        const ordered = residentOrder(tasks);
        expect(ordered).toHaveLength(tasks.length);
        expect(new Set(ordered.map((t) => t.id)).size).toBe(tasks.length);
        const keys = ordered.map((t) => t.slot.floor * 2 - t.slot.slot);
        expect(keys).toEqual([...keys].sort((a, b) => b - a));

        window.location.hash = '';
        render(<App context={{ store: createStore({ env, initial: stateOf(tasks) }), ui: createUiStore(), roam: { positionOf: () => null } }} />);
        const buttons = [...document.querySelectorAll<HTMLElement>('[data-ghost]')];
        expect(buttons.map((b) => `${b.dataset.floor}:${b.dataset.slot}`)).toEqual(ordered.map((t) => `${t.slot.floor}:${t.slot.slot}`));
        expect(document.querySelectorAll('.residents button')).toHaveLength(tasks.length);
        for (const el of document.querySelectorAll('[tabindex]')) expect(Number(el.getAttribute('tabindex'))).toBeLessThanOrEqual(0);
        cleanup();
      }),
      { numRuns: 100 },
    );
  });
});

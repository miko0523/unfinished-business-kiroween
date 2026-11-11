// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import fc from 'fast-check';
import { App } from '../../src/components/App';
import { emptyState, type AppState, type Env, type FloorNo, type SideNo, type Task } from '../../src/domain/types';
import { createStore } from '../../src/store/store';
import { createUiStore } from '../../src/store/uiStore';

const env: Env = { now: () => '2026-11-09T08:00:00.000Z', today: () => '2026-11-09', newId: () => 'id-x' };

const stepArb = fc.record({ id: fc.uuid(), title: fc.string({ minLength: 1, maxLength: 8 }), done: fc.boolean() });

/** 楼层不超过 grown 的任意住客集合，进度、状态（含 Pending）任意。 */
const tasksFor = (grown: FloorNo): fc.Arbitrary<Task[]> => {
  const slots = ([2, 3, 4, 5, 6] as FloorNo[]).filter((f) => f <= grown).flatMap((floor) => ([0, 1] as SideNo[]).map((slot) => ({ floor, slot })));
  return fc.shuffledSubarray(slots).chain((chosen) =>
    fc.tuple(...chosen.map(() => fc.record({ criteria: fc.string({ maxLength: 6 }), steps: fc.array(stepArb, { maxLength: 4 }) }))).map((bits) =>
      chosen.map((slot, i) => ({ id: `t${i}`, ghostNo: i + 1, title: `Ghost ${i}`, criteria: bits[i]!.criteria, steps: bits[i]!.steps, slot, createdAt: env.now() })),
    ),
  );
};

const stateOf = (tasks: Task[], grown: FloorNo): AppState => ({ ...emptyState(), tasks, house: { grownFloors: grown, completedCount: 0 }, nextGhostNo: tasks.length + 1 });

function staticLayerOf(state: AppState): string {
  window.location.hash = '';
  render(<App context={{ store: createStore({ env, initial: state }), ui: createUiStore(), roam: { positionOf: () => null } }} />);
  const html = document.querySelector('.static-layer')!.outerHTML;
  cleanup();
  return html;
}

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('Feature: unfinished-business, Property 27: 静态层与进度无关', () => {
  it('grownFloors 相同的两组 Task（任意进度、状态、Pending），静态层的图片源、尺寸、位置、类名与样式逐项相同', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<FloorNo>(2, 3, 4, 5, 6).chain((grown) => fc.tuple(fc.constant(grown), tasksFor(grown), tasksFor(grown))),
        ([grown, a, b]) => {
          expect(staticLayerOf(stateOf(a, grown))).toBe(staticLayerOf(stateOf(b, grown)));
        },
      ),
      { numRuns: 100 },
    );
  });
});

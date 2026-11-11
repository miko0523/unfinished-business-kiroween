// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/preact';
import { App } from '../../src/components/App';
import { createStore } from '../../src/store/store';
import { createUiStore } from '../../src/store/uiStore';
import { createMemoryPort } from '../../src/store/storagePort';
import { browserEnv } from '../../src/store/env';
import type { AppContext } from '../../src/store/StoreContext';

afterEach(cleanup);

function makeContext(): AppContext {
  return { store: createStore({ env: browserEnv(), port: createMemoryPort() }), ui: createUiStore(), roam: { positionOf: () => null } };
}
const modules = () => [...document.querySelectorAll('.static-layer [data-module]')].map((e) => e.getAttribute('data-module'));

describe('首页楼层随住客动态增长', () => {
  it('空房：门厅 + 一层住宅 + 屋顶', () => {
    render(<App context={makeContext()} />);
    expect(modules()).toEqual(['lobby', 'floor-01', 'roof']);
  });

  it('住客数首次到 3 / 5 / 7 / 9 时各长出一层；前两只不长', () => {
    const ctx = makeContext();
    render(<App context={ctx} />);
    const expected: Record<number, number> = { 1: 3, 2: 3, 3: 4, 4: 4, 5: 5, 6: 5, 7: 6, 8: 6, 9: 7, 10: 7 };
    for (let n = 1; n <= 10; n++) {
      act(() => void ctx.store.dispatch({ type: 'CreateTask', title: `Task ${n}` }));
      expect(modules(), `${n} 位住客`).toHaveLength(expected[n]!);
    }
    expect(modules()).toEqual(['lobby', 'floor-01', 'floor-02', 'floor-03', 'floor-04', 'floor-05', 'roof']);
  });

  it('楼层只升不降：住客离开后楼层数不变', () => {
    const ctx = makeContext();
    render(<App context={ctx} />);
    for (let n = 1; n <= 3; n++) act(() => void ctx.store.dispatch({ type: 'CreateTask', title: `Task ${n}` }));
    expect(modules()).toHaveLength(4);
    const first = ctx.store.getState().tasks[0]!;
    act(() => {
      ctx.store.dispatch({ type: 'SetCriteria', taskId: first.id, criteria: 'done' });
      ctx.store.dispatch({ type: 'AddStep', taskId: first.id, title: 's' });
      const step = ctx.store.getState().tasks[0]!.steps[0]!;
      ctx.store.dispatch({ type: 'ToggleStep', taskId: first.id, stepId: step.id });
      ctx.store.dispatch({ type: 'BeginConfirm', taskId: first.id });
      ctx.store.dispatch({ type: 'ConfirmComplete', taskId: first.id, memo: '' });
    });
    expect(ctx.store.getState().tasks).toHaveLength(2);
    expect(modules()).toHaveLength(4);
  });
});

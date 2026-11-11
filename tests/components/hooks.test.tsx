// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/preact';
import { useGhostPlays } from '../../src/components/useGhostPlays';
import { homeOnFloor, useRoamer } from '../../src/components/useRoamer';
import { homeOnStage } from '../../src/house/anchors';
import { layoutHouse } from '../../src/house/layout';
import type { Task } from '../../src/domain/types';
import type { AppContext } from '../../src/store/StoreContext';
import type { Store } from '../../src/store/store';

afterEach(cleanup);

describe('useRoamer：ctx.roam.positionOf 用当前 layout 现算舞台原点', () => {
  it('layout 变化（楼长高）后同一只 Ghost 的位置随之变化，且等于新舞台 home', () => {
    const ctx = { roam: { positionOf: () => null } } as unknown as AppContext;
    const task = { id: 't1', slot: { floor: 2, slot: 0 } } as unknown as Task;
    const { rerender } = renderHook(({ layout }) => useRoamer(ctx, [task], null, layout), { initialProps: { layout: layoutHouse(2) } });
    const before = ctx.roam.positionOf('t1')!;
    const h2 = homeOnStage(layoutHouse(2), task.slot)!;
    expect(before).toEqual([h2.x, h2.y]); // 刚入住时在 Home Anchor
    const taller = layoutHouse(4);
    act(() => rerender({ layout: taller }));
    const after = ctx.roam.positionOf('t1')!;
    const h4 = homeOnStage(taller, task.slot)!;
    expect(after).toEqual([h4.x, h4.y]);
    expect(after).not.toEqual(before);
    expect(homeOnFloor(task.slot)).toBeTruthy();
  });
});

describe('useGhostPlays：过期的异步家务回调', () => {
  it('勾选触发家务、随即擦除；ready 在 erase 之后才返回，不能覆盖橡皮擦', () => {
    let listener: ((e: readonly unknown[]) => void) | null = null;
    const store = { subscribeEvents: (fn: (e: readonly unknown[]) => void) => ((listener = fn), () => {}) } as unknown as Store;
    const readies: ((ok: boolean) => void)[] = [];
    const run = (_id: string, _ms: number, ready: (ok: boolean) => void) => void readies.push(ready);
    const { result } = renderHook(() => useGhostPlays(store, run));
    act(() => listener!([{ type: 'StepChecked', taskId: 'x', chore: 'sweep' }]));
    act(() => listener!([{ type: 'EraserScribble', taskId: 'x' }]));
    expect(result.current.get('x')?.kind).toBe('erase');
    act(() => readies[0]!(true)); // 旧回调迟到
    const p = result.current.get('x')!;
    expect(p.kind).toBe('erase');
    expect(p.prop).toBe('eraser');
    expect(p.choreTotal).toBe(0);
  });

  it('同一 task 连续两次勾选：只有最新的一次回调生效；正常回调仍然播放', () => {
    let listener: ((e: readonly unknown[]) => void) | null = null;
    const store = { subscribeEvents: (fn: (e: readonly unknown[]) => void) => ((listener = fn), () => {}) } as unknown as Store;
    const readies: ((ok: boolean) => void)[] = [];
    const { result } = renderHook(() => useGhostPlays(store, (_i, _m, r) => void readies.push(r)));
    act(() => listener!([{ type: 'StepChecked', taskId: 'x', chore: 'sweep' }]));
    act(() => listener!([{ type: 'StepChecked', taskId: 'x', chore: 'water' }]));
    act(() => readies[0]!(true));
    expect(result.current.get('x')).toBeUndefined();
    act(() => readies[1]!(true));
    expect(result.current.get('x')?.kind).toBe('water');
    expect(result.current.get('x')?.choreTotal).toBe(1);
  });
});

// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { App } from '../../src/components/App';
import { BACKUP_PREFIX, PRIMARY_KEY } from '../../src/persistence/keys';
import { serializeSave } from '../../src/persistence/serialize';
import { createPersistentStore } from '../../src/store/bootstrap';
import { createUiStore } from '../../src/store/uiStore';
import { emptyState, type Env } from '../../src/domain/types';
import type { AppContext } from '../../src/store/StoreContext';
import { BAD_SAVES } from '../helpers/badSaves';
import { createFakeClock } from '../helpers/clock';
import { faultyKv, type FaultyKv } from '../helpers/faultyKv';

const env: Env = { now: () => '2026-11-08T08:00:00.000Z', today: () => '2026-11-08', newId: (() => { let n = 0; return () => `id-${++n}`; })() };
const storageOf = (kv: FaultyKv) => ({
  get length() { return kv.keys().length; },
  key: (i: number) => kv.keys()[i] ?? null,
  getItem: (k: string) => kv.getItem(k),
  setItem: (k: string, v: string) => kv.setItem(k, v),
});

function boot(initial: Record<string, string> = {}, broken = false) {
  const kv = faultyKv(initial);
  const clock = createFakeClock();
  const store = createPersistentStore({ storage: broken ? null : storageOf(kv), env, clock });
  const ctx: AppContext = { store, ui: createUiStore(), roam: { positionOf: () => null } };
  return { kv, clock, ctx, store };
}

/** 一份有内容的真实存档：一只幽灵在住、纪念册里已有一条。 */
function realSave(): string {
  const base = emptyState();
  return serializeSave({
    ...base,
    tasks: [{ id: 'real-1', ghostNo: 1, title: 'Real chore', criteria: 'Done when done', steps: [{ id: 's1', title: 'one', done: true }], slot: { floor: 2, slot: 1 }, createdAt: '2026-11-01T00:00:00.000Z' }],
    nextGhostNo: 2,
  });
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

const button = (name: RegExp | string, scope: HTMLElement | Document = document.body) => within(scope as HTMLElement).getByRole('button', { name });
const tryBtn = () => button('Try sample');
const exitBtn = () => button('Exit demo', document.querySelector('.demo-bar') as HTMLElement);
const card = () => screen.getByRole('complementary', { name: /details/i });
const ghost = () => document.querySelector<HTMLElement>('[data-ghost]')!;
const boxes = () => within(card()).getAllByRole('checkbox') as HTMLInputElement[];

describe('Demo 入口与示例幽灵', () => {
  it('Try sample：顶部出现提示与 Exit demo；示例幽灵在二楼左侧，标题与条件已填，三步未完成', () => {
    const { ctx } = boot({ [PRIMARY_KEY]: realSave() });
    render(<App context={ctx} />);
    fireEvent.click(tryBtn());
    const bar = document.querySelector('.demo-bar')!;
    expect(bar.textContent).toContain('You are visiting a sample ghost. Your own house stays untouched.');
    expect(document.activeElement).toBe(exitBtn());
    const ghosts = document.querySelectorAll('[data-ghost]');
    expect(ghosts).toHaveLength(1);
    fireEvent.click(ghost());
    expect(within(card()).getByRole('heading', { name: 'Tidy the desk' })).toBeTruthy();
    expect(card().textContent).toContain('The desk is clear');
    expect(boxes().map((b) => b.checked)).toEqual([false, false, false]);
    expect(card().textContent).toMatch(/Sweep the floor/);
    expect(card().textContent).toMatch(/Water the plant/);
    expect(card().textContent).toMatch(/Wipe the window/);
    expect(ghost().getAttribute('aria-label')).toContain('floor 2');
  });

  it('示例里没有“Keep a copy”，也不会再出现第二个 Try sample', () => {
    const { ctx } = boot();
    render(<App context={ctx} />);
    fireEvent.click(tryBtn());
    expect(screen.queryByRole('button', { name: 'Keep a copy' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try sample' })).toBeNull();
  });
});

describe('Demo 隔离', () => {
  it('完整走一遍：真实 state 引用、ui、主键与备份键都与进入前相同，写入次数为 0', () => {
    vi.useFakeTimers();
    const backup = `${BACKUP_PREFIX}2026-10-01`;
    const { ctx, kv, clock } = boot({ [PRIMARY_KEY]: realSave(), [backup]: 'old backup text' });
    render(<App context={ctx} />);
    // 先让真实 ui 有选中的幽灵
    fireEvent.click(ghost());
    const stateBefore = ctx.store.getState();
    const selectedBefore = ctx.ui.getState().selectedTaskId;
    const keysBefore = Object.fromEntries(kv.keys().map((k) => [k, kv.peek(k)]));
    const attemptsBefore = kv.attempts.length;
    expect(selectedBefore).toBe('real-1');

    fireEvent.click(tryBtn());
    expect(ctx.ui.getState().selectedTaskId).toBe('real-1'); // 真实 ui 没被碰
    fireEvent.click(ghost());
    boxes().forEach((b) => fireEvent.click(b));
    act(() => void vi.advanceTimersByTime(5000));
    clock.advance(5000);
    fireEvent.click(within(card()).getByRole('button', { name: 'Confirm complete' }));
    fireEvent.click(within(screen.getByRole('dialog', { hidden: true })).getByRole('button', { name: 'Confirm complete' }));
    act(() => void vi.advanceTimersByTime(8000));
    clock.advance(5000);
    // 示例期间：真实 store 拒收动作
    const rejected = ctx.store.dispatch({ type: 'CreateTask', title: 'sneaky' });
    expect(rejected.error).toBeTruthy();
    expect(ctx.store.getState()).toBe(stateBefore);
    expect(kv.attempts.length).toBe(attemptsBefore);

    fireEvent.click(exitBtn());
    clock.advance(10_000);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(ctx.store.getState()).toBe(stateBefore);
    expect(ctx.ui.getState().selectedTaskId).toBe(selectedBefore);
    expect(Object.fromEntries(kv.keys().map((k) => [k, kv.peek(k)]))).toEqual(keysBefore);
    expect(kv.attempts.length).toBe(attemptsBefore);
    expect(kv.keys().sort()).toEqual([backup, PRIMARY_KEY].sort());
    // 退出后真实房子回来了
    expect(screen.getByRole('button', { name: 'Try sample' })).toBeTruthy();
    expect(document.activeElement).toBe(tryBtn());
    expect(ghost().getAttribute('aria-label')).toContain('Real chore');
  });

  it('进入前已排队的保存先落盘；示例期间旧计时器不再写', () => {
    const { ctx, kv, clock } = boot({ [PRIMARY_KEY]: realSave() });
    render(<App context={ctx} />);
    ctx.store.dispatch({ type: 'CreateTask', title: 'queued' }); // 防抖里排着一次保存
    expect(kv.attempts).toHaveLength(0);
    fireEvent.click(tryBtn());
    expect(kv.attempts).toHaveLength(1); // 进入时处理掉
    const saved = kv.peek(PRIMARY_KEY);
    clock.advance(10_000);
    expect(kv.attempts).toHaveLength(1);
    expect(kv.peek(PRIMARY_KEY)).toBe(saved);
    fireEvent.click(exitBtn());
    expect(ctx.store.getState().tasks.map((t) => t.title)).toContain('queued');
    clock.advance(10_000);
    expect(kv.attempts).toHaveLength(1); // 没有多余写入
  });

  it('示例期间页面隐藏或离开：任何键都不写', () => {
    const { ctx, kv } = boot({ [PRIMARY_KEY]: realSave() });
    render(<App context={ctx} />);
    fireEvent.click(tryBtn());
    fireEvent.click(ghost());
    fireEvent.click(boxes()[0]!);
    ctx.store.flush();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    expect(kv.attempts).toHaveLength(0);
  });

  it('退出后真实 store 恢复接收动作并正常保存', () => {
    const { ctx, kv, clock } = boot({ [PRIMARY_KEY]: realSave() });
    render(<App context={ctx} />);
    fireEvent.click(tryBtn());
    fireEvent.click(exitBtn());
    ctx.store.dispatch({ type: 'CreateTask', title: 'after' });
    clock.advance(1000);
    expect(JSON.parse(kv.peek(PRIMARY_KEY)!).tasks.map((t: { title: string }) => t.title)).toContain('after');
  });
});

describe('Demo 退出的各个位置', () => {
  it('在示例纪念册里退出：hash 还原成进入前的样子', async () => {
    const { ctx } = boot();
    render(<App context={ctx} />);
    fireEvent.click(tryBtn());
    window.location.hash = '#/archive';
    await waitFor(() => expect(document.querySelector('.archive')).toBeTruthy());
    fireEvent.click(exitBtn());
    expect(window.location.hash).toBe('');
    expect(document.querySelector('.archive')).toBeNull();
    expect(tryBtn()).toBeTruthy();
  });

  it('进入前正在看真实纪念册：示例从房子开始，退出后回到真实纪念册', async () => {
    const { ctx } = boot({ [PRIMARY_KEY]: realSave() });
    window.location.hash = '#/archive';
    render(<App context={ctx} />);
    await waitFor(() => expect(document.querySelector('.archive')).toBeTruthy());
    fireEvent.click(tryBtn());
    expect(window.location.hash).toBe('#/');
    expect(document.querySelector('.archive')).toBeNull();
    fireEvent.click(exitBtn());
    expect(window.location.hash).toBe('#/archive');
    expect(document.querySelector('.archive')).toBeTruthy();
  });

  it('确认框打开时退出：对话框里有 Exit demo，退出后焦点落在 Try sample，没有残留对话框', () => {
    const { ctx } = boot({ [PRIMARY_KEY]: realSave() });
    render(<App context={ctx} />);
    fireEvent.click(tryBtn());
    fireEvent.click(ghost());
    boxes().forEach((b) => fireEvent.click(b));
    fireEvent.click(within(card()).getByRole('button', { name: 'Confirm complete' }));
    const dialog = document.querySelector('dialog')!;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Exit demo' }));
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(tryBtn());
    expect(ctx.store.flow.getState().confirmingId).toBeNull();
  });

  it('抽屉打开时退出：顶部的 Exit demo 仍在', () => {
    const { ctx } = boot();
    render(<App context={ctx} />);
    fireEvent.click(tryBtn());
    fireEvent.click(ghost());
    expect(card()).toBeTruthy();
    fireEvent.click(exitBtn());
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('再次进入是一份全新的示例，上一次的纪念册不会留下', () => {
    vi.useFakeTimers();
    const { ctx } = boot();
    render(<App context={ctx} />);
    fireEvent.click(tryBtn());
    fireEvent.click(ghost());
    boxes().forEach((b) => fireEvent.click(b));
    fireEvent.click(within(card()).getByRole('button', { name: 'Confirm complete' }));
    fireEvent.click(within(document.querySelector('dialog')!).getByRole('button', { name: 'Confirm complete' }));
    act(() => void vi.advanceTimersByTime(8000));
    fireEvent.click(exitBtn());
    fireEvent.click(tryBtn());
    expect(document.querySelectorAll('[data-ghost]')).toHaveLength(1);
    fireEvent.click(ghost());
    expect(boxes().map((b) => b.checked)).toEqual([false, false, false]);
  });
});

describe('恢复界面与内存模式', () => {
  it('恢复界面不显示 Try sample', () => {
    const { ctx, kv } = boot({ [PRIMARY_KEY]: BAD_SAVES[Object.keys(BAD_SAVES)[0]!]! });
    render(<App context={ctx} />);
    expect(ctx.store.session.getState().mode).toBe('recovery');
    expect(screen.queryByRole('button', { name: 'Try sample' })).toBeNull();
    expect(kv.attempts).toHaveLength(0);
  });

  it('内存模式可进入示例，退出后仍是内存模式，状态引用不变，零写入', () => {
    const { ctx, kv } = boot({}, true);
    render(<App context={ctx} />);
    expect(ctx.store.session.getState().mode).toBe('memory');
    ctx.store.dispatch({ type: 'CreateTask', title: 'in memory' });
    const before = ctx.store.getState();
    fireEvent.click(tryBtn());
    expect(document.querySelector('.demo-bar')).toBeTruthy();
    fireEvent.click(exitBtn());
    expect(ctx.store.session.getState().mode).toBe('memory');
    expect(ctx.store.getState()).toBe(before);
    expect(kv.attempts).toHaveLength(0);
    expect(document.querySelector('.storage-notice')).toBeTruthy();
  });

  it('恢复模式下即使直接调用，也进不了示例', () => {
    const { ctx } = boot({ [PRIMARY_KEY]: BAD_SAVES[Object.keys(BAD_SAVES)[0]!]! });
    const { container } = render(<App context={ctx} />);
    expect(container.querySelector('.demo-bar')).toBeNull();
  });
});

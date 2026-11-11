// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { readFileSync } from 'node:fs';
import { App } from '../../src/components/App';
import { COPY_KEYS } from '../../src/i18n/copy';
import { en } from '../../src/i18n/en';
import { residentOrder } from '../../src/house/order';
import { slotKey } from '../../src/domain/slots';
import { PRIMARY_KEY } from '../../src/persistence/keys';
import { serializeSave } from '../../src/persistence/serialize';
import { createPersistentStore } from '../../src/store/bootstrap';
import { createStore } from '../../src/store/store';
import { createUiStore } from '../../src/store/uiStore';
import { createMemoryPort } from '../../src/store/storagePort';
import { browserEnv } from '../../src/store/env';
import { emptyState, type Env } from '../../src/domain/types';
import type { AppContext } from '../../src/store/StoreContext';
import { createFakeClock } from '../helpers/clock';
import { faultyKv } from '../helpers/faultyKv';

function makeContext(): AppContext {
  return { store: createStore({ env: browserEnv(), port: createMemoryPort() }), ui: createUiStore(), roam: { positionOf: () => null } };
}

function reducedMotion(on: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: on && q.includes('reduce'),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  reducedMotion(false);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

const input = () => screen.getByLabelText(/still waiting/i) as HTMLInputElement;
function create(text: string) {
  fireEvent.input(input(), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: /welcome a little ghost/i }));
}
const ghosts = () => [...document.querySelectorAll<HTMLElement>('[data-ghost]')];
const residentsList = () => document.querySelector<HTMLElement>('ul[aria-label="Residents"]')!;
const REQ = readFileSync('.kiro/specs/unfinished-business/requirements.md', 'utf8');
const R15 = /显示文案“(The house is full\.[^”]*)”/.exec(REQ)![1]!;

describe('9.1 满员：第 11 次保留草稿，温柔提示，焦点交给住客列表', () => {
  it('提示文案与需求 R1.5 原文逐字符相等；不创建、不排队、草稿保留', () => {
    expect(en['create.error.houseFull']).toBe(R15);
    render(<App />);
    for (let i = 0; i < 10; i++) create(`t${i}`);
    create('eleventh');
    const dialog = document.querySelector('dialog')!;
    expect(within(dialog).getByText(R15)).toBeTruthy();
    expect(dialog.querySelector('#full-house-text')!.textContent).toBe(R15);
    expect(dialog.getAttribute('aria-labelledby')).toBe('full-house-text');
    expect(within(dialog).getAllByRole('button').map((b) => b.textContent)).toEqual(['Visit residents', 'Come back later']);
    expect(input().value).toBe('eleventh');
    expect(ghosts()).toHaveLength(10);
    // 不催促、不愧疚
    expect(R15).not.toMatch(/\b(hurry|late|failed|shame|guilty|give up)\b/i);
  });

  it('“Visit residents”：关闭提示，焦点落在语义住客列表，草稿还在', () => {
    render(<App />);
    for (let i = 0; i < 10; i++) create(`t${i}`);
    create('eleventh');
    fireEvent.click(screen.getByRole('button', { name: 'Visit residents' }));
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(residentsList());
    expect(document.activeElement!.getAttribute('aria-label')).toBe('Residents');
    expect(input().value).toBe('eleventh');
    expect(ghosts()).toHaveLength(10);
  });

  it('“Come back later”与 Esc：只关闭提示；腾出一个位置后同一份草稿就能入住', () => {
    const ctx = makeContext();
    render(<App context={ctx} />);
    for (let i = 0; i < 10; i++) create(`t${i}`);
    create('eleventh');
    fireEvent.click(screen.getByRole('button', { name: 'Come back later' }));
    expect(document.querySelector('dialog')).toBeNull();
    expect(input().value).toBe('eleventh');
    create('eleventh'); // 草稿原样再提交一次
    fireEvent.keyDown(document.querySelector('dialog')!, { key: 'Escape' });
    expect(document.querySelector('dialog')).toBeNull();
    expect(ctx.store.getState().tasks).toHaveLength(10);

    const gone = ctx.store.getState().tasks[3]!;
    act(() => void ctx.store.dispatch({ type: 'DeleteTask', taskId: gone.id }));
    create('eleventh');
    const tasks = ctx.store.getState().tasks;
    expect(tasks).toHaveLength(10);
    expect(tasks.at(-1)!.title).toBe('eleventh');
    expect(tasks.at(-1)!.slot).toEqual(gone.slot);
    expect(input().value).toBe('');
  });

  it('确认完成与删除都只腾出自己的 Slot（10 只住满时各腾一个）', () => {
    const ctx = makeContext();
    render(<App context={ctx} />);
    for (let i = 0; i < 10; i++) create(`t${i}`);
    const before = ctx.store.getState().tasks;
    const target = before[5]!;
    act(() => {
      ctx.store.dispatch({ type: 'SetCriteria', taskId: target.id, criteria: 'ok' });
      ctx.store.dispatch({ type: 'AddStep', taskId: target.id, title: 's' });
      ctx.store.dispatch({ type: 'ToggleStep', taskId: target.id, stepId: ctx.store.getState().tasks[5]!.steps[0]!.id });
      ctx.store.dispatch({ type: 'BeginConfirm', taskId: target.id });
      ctx.store.dispatch({ type: 'ConfirmComplete', taskId: target.id, memo: '' });
    });
    const after = ctx.store.getState().tasks;
    expect(after.map((t) => t.id)).toEqual(before.filter((t) => t.id !== target.id).map((t) => t.id));
    expect(after.map((t) => slotKey(t.slot))).not.toContain(slotKey(target.slot));
  });
});

describe('9.2 语义住客列表：Residents → 楼层 → 住客', () => {
  it('顶层 Residents 列表；每个有住客的楼层一个有名称的 li，内层是列表；每只 Ghost 恰有一个按钮', () => {
    const ctx = makeContext();
    render(<App context={ctx} />);
    for (let i = 0; i < 5; i++) create(`t${i}`);
    const top = residentsList();
    expect(top.tagName).toBe('UL');
    expect(document.querySelectorAll('ul[aria-label="Residents"]')).toHaveLength(1);
    const floors = [...top.children] as HTMLElement[];
    expect(floors.map((f) => f.tagName)).toEqual(['LI', 'LI', 'LI']);
    expect(floors.map((f) => f.getAttribute('data-floor'))).toEqual(['4', '3', '2']);
    for (const li of floors) {
      const nameId = li.getAttribute('aria-labelledby')!;
      expect(li.querySelector(`#${nameId}`)!.textContent).toBe(`Floor ${li.getAttribute('data-floor')}`);
      const inner = li.querySelector(':scope > ul')!;
      expect(inner).toBeTruthy();
      for (const item of inner.children) {
        expect(item.tagName).toBe('LI');
        expect(item.querySelectorAll('button')).toHaveLength(1);
      }
    }
    // 每只 Ghost 只对应一个按钮，且按钮都在这棵列表里
    expect(top.querySelectorAll('button')).toHaveLength(5);
    expect(document.querySelectorAll('[data-ghost]')).toHaveLength(5);
    expect(ctx.store.getState().tasks).toHaveLength(5);
  });

  it('属性 26 示例：DOM 顺序 = residentOrder = Tab 顺序（没有 tabindex > 0）', () => {
    const ctx = makeContext();
    render(<App context={ctx} />);
    for (let i = 0; i < 9; i++) create(`t${i}`);
    // 删掉两只，让空位参与排序
    act(() => {
      ctx.store.dispatch({ type: 'DeleteTask', taskId: ctx.store.getState().tasks[1]!.id });
      ctx.store.dispatch({ type: 'DeleteTask', taskId: ctx.store.getState().tasks[4]!.id });
    });
    create('again');
    const expected = residentOrder(ctx.store.getState().tasks).map((t) => `${t.slot.floor}:${t.slot.slot}`);
    expect(ghosts().map((b) => `${b.dataset.floor}:${b.dataset.slot}`)).toEqual(expected);
    // 从高到低、同层从左到右
    const keys = ghosts().map((b) => Number(b.dataset.floor) * 10 - Number(b.dataset.slot));
    expect(keys).toEqual([...keys].sort((a, b) => b - a));
    for (const el of document.querySelectorAll('[tabindex]')) expect(Number(el.getAttribute('tabindex'))).toBeLessThanOrEqual(0);
    // 列表本身只能被程序聚焦，不进入 Tab 序列
    expect(residentsList().getAttribute('tabindex')).toBe('-1');
  });

  it('3 / 5 / 7 / 9 只时楼层长高：结构类与静态层都跟着 grownFloors，且只升不降', () => {
    const ctx = makeContext();
    render(<App context={ctx} />);
    const house = () => document.querySelector('.house')!;
    const seen: number[] = [];
    const events: number[] = [];
    ctx.store.subscribeEvents((es) => es.forEach((e) => e.type === 'FloorGrown' && events.push(e.floor)));
    for (let n = 1; n <= 10; n++) {
      act(() => void ctx.store.dispatch({ type: 'CreateTask', title: `T${n}` }));
      seen.push(Number(house().getAttribute('data-grown-floors')));
    }
    expect(seen).toEqual([2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
    expect(events).toEqual([3, 4, 5, 6]);
    // 删到只剩一只：仍是 6 层（直接最终布局，不塌回）
    act(() => {
      for (const t of [...ctx.store.getState().tasks].slice(1)) ctx.store.dispatch({ type: 'DeleteTask', taskId: t.id });
    });
    expect(house().getAttribute('data-grown-floors')).toBe('6');
    expect([...document.querySelectorAll('.static-layer [data-module]')].map((e) => e.getAttribute('data-module'))).toEqual([
      'lobby', 'floor-01', 'floor-02', 'floor-03', 'floor-04', 'floor-05', 'roof',
    ]);
  });
});

describe('9.5 删除未完成的 Task（搬走）', () => {
  function openCard(title: RegExp) {
    fireEvent.click(screen.getByRole('button', { name: title }));
  }

  it('card 里“Say goodbye”→ 中性对话框 → 搬走：不进纪念册、室友原样、事件与播报、Slot 可复用', () => {
    const ctx = makeContext();
    render(<App context={ctx} />);
    create('Leaving one');
    create('Staying one');
    const [leaver, mate] = ctx.store.getState().tasks;
    openCard(/leaving one/i);
    fireEvent.click(screen.getByRole('button', { name: 'Say goodbye' }));
    const dialog = document.querySelector('dialog')!;
    const words = dialog.textContent!;
    expect(words).toBe(`${en['moveOut.title']}${en['moveOut.body']}${en['moveOut.yes']}${en['moveOut.no']}`);
    expect(words).not.toMatch(/give up|fail|abandon|quit|放弃|失败/i);

    // 先“Let it stay”：什么都没发生
    fireEvent.click(within(dialog).getByRole('button', { name: 'Let it stay' }));
    expect(document.querySelector('dialog')).toBeNull();
    expect(ctx.store.getState().tasks).toHaveLength(2);

    const events: string[] = [];
    ctx.store.subscribeEvents((es) => es.forEach((e) => events.push(e.type)));
    fireEvent.click(screen.getByRole('button', { name: 'Say goodbye' }));
    fireEvent.click(screen.getByRole('button', { name: 'Wave goodbye' }));

    const state = ctx.store.getState();
    expect(events).toEqual(['MovedOutQuietly']);
    expect(state.tasks).toEqual([mate]);
    expect(state.tasks[0]).toBe(mate);
    expect(state.archive).toEqual([]);
    expect(state.house.completedCount).toBe(0);
    expect(screen.getByRole('status').textContent).toBe('The little ghost packed its suitcase and moved out quietly.');
    expect(screen.queryByRole('complementary')).toBeNull(); // 详情卡随之关闭
    expect(document.activeElement).toBe(input());
    // 列表里只剩室友的按钮；离场的那只只是一个不可操作的样子
    expect(ghosts()).toHaveLength(1);
    expect(document.querySelectorAll('.residents-leaving [data-ghost], .residents-leaving button')).toHaveLength(0);
    expect(document.querySelector('.residents-leaving')!.getAttribute('aria-hidden')).toBe('true');
    // 没有纪念：纪念册还是空的
    expect(leaver).toBeTruthy();
    act(() => {
      window.location.hash = '#/archive';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByText(en['archive.empty'])).toBeTruthy();
  });

  it('搬走的是正在被选中的那只：详情卡关闭；搬走的是室友：详情卡保持', () => {
    const ctx = makeContext();
    render(<App context={ctx} />);
    create('A');
    create('B');
    openCard(/: A,/);
    expect(screen.getByRole('complementary')).toBeTruthy();
    act(() => void ctx.store.dispatch({ type: 'DeleteTask', taskId: ctx.store.getState().tasks[1]!.id }));
    expect(screen.getByRole('complementary')).toBeTruthy();
    expect(ghosts()).toHaveLength(1);
  });

  it('搬走演完（约 1.5 秒）前，新来的住客在刚腾出的家里先不露面；演完后才入住并走进来', () => {
    vi.useFakeTimers();
    const ctx = makeContext();
    render(<App context={ctx} />);
    act(() => {
      ctx.store.dispatch({ type: 'CreateTask', title: 'First' });
      ctx.store.dispatch({ type: 'CreateTask', title: 'Second' });
    });
    act(() => void vi.advanceTimersByTime(4000));
    const first = ctx.store.getState().tasks[0]!;
    act(() => void ctx.store.dispatch({ type: 'DeleteTask', taskId: first.id }));
    expect(ctx.ui.getState().holds.get(slotKey(first.slot))).toBe(first.id);
    expect(document.querySelectorAll('.residents-leaving .is-leaving')).toHaveLength(1);

    // 数据里 Slot 立即可用
    act(() => void ctx.store.dispatch({ type: 'CreateTask', title: 'Newcomer' }));
    const newcomer = ctx.store.getState().tasks.find((t) => t.title === 'Newcomer')!;
    expect(newcomer.slot).toEqual(first.slot);
    const waitingItems = () => document.querySelectorAll('li.resident[data-waiting="true"]');
    expect(waitingItems()).toHaveLength(1);
    expect(ctx.roam.positionOf(newcomer.id)).toBeNull();
    expect(document.querySelectorAll('li.resident[data-waiting="true"] .ghost-enter')).toHaveLength(0);

    act(() => void vi.advanceTimersByTime(1300));
    expect(waitingItems()).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(1500));
    expect(ctx.ui.getState().holds.size).toBe(0);
    expect(document.querySelectorAll('.residents-leaving .is-leaving')).toHaveLength(0);
    expect(waitingItems()).toHaveLength(0);
    expect(ctx.roam.positionOf(newcomer.id)).not.toBeNull();
    const newcomerItem = screen.getByRole('button', { name: /newcomer/i }).closest('li')!;
    expect(newcomerItem.querySelectorAll('.ghost-enter')).toHaveLength(1);
  });

  it('Reduced Motion：直接移除并播报，没有离场演员，也不占用 Slot', () => {
    reducedMotion(true);
    const ctx = makeContext();
    render(<App context={ctx} />);
    create('A');
    create('B');
    const first = ctx.store.getState().tasks[0]!;
    act(() => void ctx.store.dispatch({ type: 'DeleteTask', taskId: first.id }));
    expect(document.querySelector('.residents-leaving')).toBeNull();
    expect(ctx.ui.getState().holds.size).toBe(0);
    expect(ghosts()).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toBe('The little ghost packed its suitcase and moved out quietly.');
    act(() => void ctx.store.dispatch({ type: 'CreateTask', title: 'C' }));
    expect(document.querySelectorAll('li.resident[data-waiting="true"]')).toHaveLength(0);
    expect(ghosts()).toHaveLength(2);
  });

  it('文案扫描：搬走相关文字不含“放弃 / 失败”之类的词', () => {
    const keys = COPY_KEYS.filter((k) => k.startsWith('moveOut.') || k === 'live.movedOut' || k.startsWith('fullHouse.'));
    expect(keys.length).toBeGreaterThanOrEqual(8);
    for (const k of keys) expect(en[k], k).not.toMatch(/give up|fail|abandon|quit|gave up|放弃|失败/i);
  });
});

describe('9.5 庆祝与入住并发：飞行开始约 0.5 秒后，新住客才在刚腾出的家露面', () => {
  function completeAndConfirm(ctx: AppContext, index: number) {
    const target = ctx.store.getState().tasks[index]!;
    act(() => {
      ctx.store.dispatch({ type: 'SetCriteria', taskId: target.id, criteria: 'ok' });
      ctx.store.dispatch({ type: 'AddStep', taskId: target.id, title: 's' });
      ctx.store.dispatch({ type: 'ToggleStep', taskId: target.id, stepId: ctx.store.getState().tasks[index]!.steps[0]!.id });
      ctx.store.dispatch({ type: 'BeginConfirm', taskId: target.id });
      ctx.store.dispatch({ type: 'ConfirmComplete', taskId: target.id, memo: '' });
    });
    return target;
  }

  it('变金 / 挥手 / 盖章阶段（2.8 秒）Slot 仍被占着；飞行开始后 0.5 秒（3.3 秒）归还', () => {
    vi.useFakeTimers();
    const ctx = makeContext();
    render(<App context={ctx} />);
    act(() => {
      ctx.store.dispatch({ type: 'CreateTask', title: 'A' });
      ctx.store.dispatch({ type: 'CreateTask', title: 'B' });
    });
    act(() => void vi.advanceTimersByTime(4000));
    const gone = completeAndConfirm(ctx, 0);
    expect(ctx.ui.getState().holds.get(slotKey(gone.slot))).toBe(gone.id);
    act(() => void ctx.store.dispatch({ type: 'CreateTask', title: 'C' }));
    const waiting = () => document.querySelectorAll('li.resident[data-waiting="true"]').length;
    expect(waiting()).toBe(1);
    act(() => void vi.advanceTimersByTime(2790));
    expect(waiting()).toBe(1);
    act(() => void vi.advanceTimersByTime(520));
    expect(waiting()).toBe(0);
    expect(ctx.ui.getState().holds.size).toBe(0);
  });

  it('点“跳过”：立刻归还；Reduced Motion 的静止盖章页演完（2.4 秒）后归还', () => {
    vi.useFakeTimers();
    const ctx = makeContext();
    render(<App context={ctx} />);
    act(() => {
      ctx.store.dispatch({ type: 'CreateTask', title: 'A' });
      ctx.store.dispatch({ type: 'CreateTask', title: 'B' });
    });
    completeAndConfirm(ctx, 0);
    expect(ctx.ui.getState().holds.size).toBe(1);
    act(() => void vi.advanceTimersByTime(10));
    fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(ctx.ui.getState().holds.size).toBe(0);

    cleanup();
    reducedMotion(true);
    const ctx2 = makeContext();
    render(<App context={ctx2} />);
    act(() => {
      ctx2.store.dispatch({ type: 'CreateTask', title: 'A' });
      ctx2.store.dispatch({ type: 'CreateTask', title: 'B' });
    });
    completeAndConfirm(ctx2, 0);
    expect(ctx2.ui.getState().holds.size).toBe(1);
    act(() => void vi.advanceTimersByTime(2500));
    expect(ctx2.ui.getState().holds.size).toBe(0);
  });

  it('庆祝中的那只留在调度里当障碍直到归还；归还后移出，新住客入住时没有重复的住客', () => {
    vi.useFakeTimers();
    const ctx = makeContext();
    render(<App context={ctx} />);
    act(() => {
      ctx.store.dispatch({ type: 'CreateTask', title: 'A' });
      ctx.store.dispatch({ type: 'CreateTask', title: 'B' });
    });
    act(() => void vi.advanceTimersByTime(6000));
    const gone = completeAndConfirm(ctx, 0);
    expect(ctx.roam.positionOf(gone.id)).not.toBeNull();
    act(() => void vi.advanceTimersByTime(3400));
    expect(ctx.roam.positionOf(gone.id)).toBeNull();
    act(() => void ctx.store.dispatch({ type: 'CreateTask', title: 'C' }));
    expect(ghosts()).toHaveLength(2);
  });
});

describe('Demo / 存档 / 恢复 与阶段 9 的衔接', () => {
  const env: Env = { now: () => '2026-11-08T08:00:00.000Z', today: () => '2026-11-08', newId: (() => { let n = 0; return () => `id-${++n}`; })() };
  const storageOf = (kv: ReturnType<typeof faultyKv>) => ({
    get length() { return kv.keys().length; },
    key: (i: number) => kv.keys()[i] ?? null,
    getItem: (k: string) => kv.getItem(k),
    setItem: (k: string, v: string) => kv.setItem(k, v),
  });

  it('示例里同样的满员提示与搬走；真实数据一字不动，退出后原样回来', () => {
    const base = emptyState();
    const kv = faultyKv({
      [PRIMARY_KEY]: serializeSave({
        ...base,
        tasks: [{ id: 'real-1', ghostNo: 1, title: 'Real chore', criteria: 'x', steps: [], slot: { floor: 2, slot: 0 }, createdAt: '2026-11-01T00:00:00.000Z' }],
        nextGhostNo: 2,
      }),
    });
    const clock = createFakeClock();
    const ctx: AppContext = { store: createPersistentStore({ storage: storageOf(kv), env, clock }), ui: createUiStore(), roam: { positionOf: () => null } };
    const realBefore = ctx.store.getState();
    const written = kv.getItem(PRIMARY_KEY);
    render(<App context={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try sample' }));
    for (let i = 0; i < 9; i++) create(`d${i}`);
    create('over');
    const dialog = document.querySelector('dialog')!;
    expect(within(dialog).getByRole('button', { name: 'Exit demo' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Visit residents' }));
    expect(document.activeElement).toBe(residentsList());

    // 搬走一只示例幽灵
    fireEvent.click(screen.getByRole('button', { name: /Wash the mugs|d0/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Say goodbye' }));
    expect(within(document.querySelector('dialog')!).getByRole('button', { name: 'Exit demo' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Wave goodbye' }));

    act(() => void clock.advance(5000));
    expect(kv.getItem(PRIMARY_KEY)).toBe(written);
    fireEvent.click(document.querySelector<HTMLButtonElement>('.demo-bar button')!);
    expect(ctx.store.getState()).toBe(realBefore);
    expect(ghosts().map((g) => g.getAttribute('aria-label'))[0]).toContain('Real chore');
  });

  it('刷新后：搬走过的 Task 不会回来，空出的家还在，楼层仍是长高后的样子', () => {
    const kv = faultyKv({});
    const clock = createFakeClock();
    const ctx: AppContext = { store: createPersistentStore({ storage: storageOf(kv), env, clock }), ui: createUiStore(), roam: { positionOf: () => null } };
    for (let i = 0; i < 5; i++) ctx.store.dispatch({ type: 'CreateTask', title: `T${i}` });
    const gone = ctx.store.getState().tasks[1]!;
    ctx.store.dispatch({ type: 'DeleteTask', taskId: gone.id });
    ctx.store.flush();
    const reopened = createPersistentStore({ storage: storageOf(kv), env, clock: createFakeClock() });
    expect(reopened.getState().tasks.map((t) => t.title)).toEqual(['T0', 'T2', 'T3', 'T4']);
    expect(reopened.getState().archive).toEqual([]);
    expect(reopened.getState().house.grownFloors).toBe(4);
    reopened.dispatch({ type: 'CreateTask', title: 'back' });
    expect(reopened.getState().tasks.at(-1)!.slot).toEqual(gone.slot);
  });

  it('恢复界面不显示阶段 9 的入口：没有住客列表、创建框、满员提示或搬走', () => {
    const kv = faultyKv({ [PRIMARY_KEY]: '{not json' });
    const ctx: AppContext = { store: createPersistentStore({ storage: storageOf(kv), env, clock: createFakeClock() }), ui: createUiStore(), roam: { positionOf: () => null } };
    expect(ctx.store.session.getState().mode).toBe('recovery');
    render(<App context={ctx} />);
    expect(document.querySelector('ul[aria-label="Residents"]')).toBeNull();
    expect(document.querySelector('.residents-leaving')).toBeNull();
    expect(screen.queryByLabelText(/still waiting/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /move out|Visit residents/i })).toBeNull();
    expect(document.querySelector('dialog')).toBeNull();
  });
});

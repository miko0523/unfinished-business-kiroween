// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { App } from '../../src/components/App';
import { PRIMARY_KEY } from '../../src/persistence/keys';
import { parseSave } from '../../src/persistence/parse';
import { createPersistentStore } from '../../src/store/bootstrap';
import { createUiStore } from '../../src/store/uiStore';
import { en } from '../../src/i18n/en';
import { BAD_SAVES, INVALID_JSON } from '../helpers/badSaves';
import { createFakeClock } from '../helpers/clock';
import { faultyKv, type FaultyKv } from '../helpers/faultyKv';
import type { AppContext } from '../../src/store/StoreContext';
import type { Env } from '../../src/domain/types';

const env: Env = { now: () => '2026-11-08T08:00:00.000Z', today: () => '2026-11-08', newId: (() => { let n = 0; return () => `id-${++n}`; })() };

function storageOf(kv: FaultyKv) {
  return { get length() { return kv.keys().length; }, key: (i: number) => kv.keys()[i] ?? null, getItem: (k: string) => kv.getItem(k), setItem: (k: string, v: string) => kv.setItem(k, v) };
}

function boot(kv: FaultyKv) {
  const clock = createFakeClock();
  const store = createPersistentStore({ storage: storageOf(kv), env, clock });
  const ctx: AppContext = { store, ui: createUiStore(), roam: { positionOf: () => null } };
  return { ctx, clock };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-08T08:00:00.000Z'));
  window.location.hash = '';
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

const button = (name: string) => screen.getByRole('button', { name });
const FRESH = 'Back up the old save and start fresh';
const BLANK = 'Carry on with a blank page';
const COPY = 'Keep a copy of the old notebook';

function stubDownload() {
  const blobs: Blob[] = [];
  const names: string[] = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
    blobs.push(b as Blob);
    return 'blob:stub';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    names.push(this.download);
  });
  return { blobs, names };
}

describe.each(Object.entries(BAD_SAVES))('恢复界面：%s', (_name, raw) => {
  it('只显示专用恢复界面，不显示空房子；打开时零写入；不泄露技术内容', () => {
    const kv = faultyKv({ [PRIMARY_KEY]: raw });
    const { ctx, clock } = boot(kv);
    render(<App context={ctx} />);
    clock.advance(5000);

    expect(screen.getByRole('heading', { name: en['recovery.title'] })).toBeTruthy();
    expect(screen.getByText(en['recovery.body'])).toBeTruthy();
    for (const name of [COPY, BLANK, FRESH]) expect(button(name)).toBeTruthy();
    // 没有看似正常的空房子
    expect(document.querySelector('.house-view')).toBeNull();
    expect(document.querySelector('[data-ghost]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Welcome a little ghost' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Keep a copy' })).toBeNull();
    // 不显示技术错误、键名、原始内容
    const shown = document.body.textContent ?? '';
    expect(shown).not.toMatch(/ub:|schema|JSON|SyntaxError|ghostNo|floor-0/);
    expect(shown).not.toContain(raw.slice(0, 12));
    // 零写入，主键原样
    expect(kv.attempts).toHaveLength(0);
    expect(kv.peek(PRIMARY_KEY)).toBe(raw);
  });
});

describe('选项一：下载副本', () => {
  it('Blob 内容与原始字符串逐字符相同，UTF-8，不写任何键，仍留在恢复界面', async () => {
    const kv = faultyKv({ [PRIMARY_KEY]: INVALID_JSON });
    const { ctx } = boot(kv);
    const dl = stubDownload();
    render(<App context={ctx} />);
    fireEvent.click(button(COPY));
    expect(dl.blobs).toHaveLength(1);
    expect(dl.blobs[0]!.type).toContain('utf-8');
    expect(await dl.blobs[0]!.text()).toBe(INVALID_JSON);
    expect(dl.names).toEqual(['unfinished-business-old-notebook-20261108.txt']);
    expect(screen.getByText(en['recovery.copy.done'])).toBeTruthy();
    expect(ctx.store.session.getState().mode).toBe('recovery');
    expect(kv.attempts).toHaveLength(0);
  });

  it('下载失败：温柔提示，状态与存储都不变，三个选项仍在', () => {
    const kv = faultyKv({ [PRIMARY_KEY]: INVALID_JSON });
    const { ctx } = boot(kv);
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      throw new Error('nope');
    });
    render(<App context={ctx} />);
    const before = ctx.store.session.getState();
    fireEvent.click(button(COPY));
    expect(screen.getByRole('alert').textContent).toBe(en['recovery.copy.failed']);
    expect(ctx.store.session.getState()).toBe(before);
    expect(kv.attempts).toHaveLength(0);
    for (const name of [COPY, BLANK, FRESH]) expect(button(name)).toBeTruthy();
  });
});

describe('选项二：空白页在内存中继续', () => {
  it('进入房子，顶部持续提示“这次不会收起来”并突出导出；之后所有操作零写入，主键不动', () => {
    const kv = faultyKv({ [PRIMARY_KEY]: INVALID_JSON });
    const { ctx, clock } = boot(kv);
    render(<App context={ctx} />);
    fireEvent.click(button(BLANK));

    expect(screen.queryByRole('heading', { name: en['recovery.title'] })).toBeNull();
    expect(document.querySelector('.house-view')).not.toBeNull();
    expect(document.querySelector('.storage-notice')!.textContent).toBe(en['notice.memory']);
    expect(button('Keep a copy').className).toContain('loud');
    expect(ctx.store.session.getState()).toEqual({ mode: 'memory', storage: 'ok', raw: null });

    ctx.store.dispatch({ type: 'CreateTask', title: 'Tidy the desk' });
    ctx.store.flush();
    clock.advance(10_000);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    act(() => void window.dispatchEvent(new Event('pagehide')));
    expect(kv.attempts).toHaveLength(0);
    expect(kv.peek(PRIMARY_KEY)).toBe(INVALID_JSON);
    expect(kv.keys()).toEqual([PRIMARY_KEY]);
  });

  it('导出的是当前内存里的游戏数据', async () => {
    const kv = faultyKv({ [PRIMARY_KEY]: INVALID_JSON });
    const { ctx } = boot(kv);
    const dl = stubDownload();
    render(<App context={ctx} />);
    fireEvent.click(button(BLANK));
    ctx.store.dispatch({ type: 'CreateTask', title: '整理书桌' });
    fireEvent.click(button('Keep a copy'));
    fireEvent.click(within(document.querySelector('dialog')!).getByRole('button', { name: 'Pack the keepsake' }));
    const parsed = parseSave(await dl.blobs[0]!.text());
    expect(parsed.ok && parsed.value.tasks.map((t) => t.title)).toEqual(['整理书桌']);
    expect(kv.attempts).toHaveLength(0);
  });
});

describe('选项三：备份并重新开始', () => {
  it('先过确认对话框；取消与 Esc 都不写任何键，焦点回到按钮', () => {
    const kv = faultyKv({ [PRIMARY_KEY]: INVALID_JSON });
    const { ctx } = boot(kv);
    render(<App context={ctx} />);
    const opener = button(FRESH);
    opener.focus();
    fireEvent.click(opener);
    const dialog = document.querySelector('dialog')!;
    expect(dialog.textContent).toContain(en['recovery.fresh.title']);
    expect(kv.attempts).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole('button', { name: en['recovery.fresh.no'] }));
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(kv.attempts).toHaveLength(0);

    fireEvent.click(opener);
    fireEvent.keyDown(document.querySelector('dialog')!, { key: 'Escape' });
    expect(document.querySelector('dialog')).toBeNull();
    expect(kv.attempts).toHaveLength(0);
    expect(ctx.store.session.getState().mode).toBe('recovery');
  });

  it('确认后：备份在前、新空存档在后，进入正常空房子；重开能正常读到', () => {
    const kv = faultyKv({ [PRIMARY_KEY]: INVALID_JSON, 'ub:backup:1': 'older' });
    const { ctx, clock } = boot(kv);
    render(<App context={ctx} />);
    fireEvent.click(button(FRESH));
    fireEvent.click(within(document.querySelector('dialog')!).getByRole('button', { name: en['recovery.fresh.yes'] }));

    expect(kv.attempts.map((a) => a.key)).toEqual(['ub:backup:2', PRIMARY_KEY]);
    expect(kv.peek('ub:backup:2')).toBe(INVALID_JSON);
    expect(kv.peek('ub:backup:1')).toBe('older');
    expect(parseSave(kv.peek(PRIMARY_KEY)!).ok).toBe(true);
    expect(document.querySelector('.house-view')).not.toBeNull();
    expect(document.querySelector('.storage-notice')).toBeNull();
    expect(ctx.store.session.getState()).toEqual({ mode: 'normal', storage: 'ok', raw: null });
    // 不显示备份键名
    expect(document.body.textContent).not.toMatch(/ub:/);

    // 之后的变更正常保存
    ctx.store.dispatch({ type: 'CreateTask', title: 'Tidy the desk' });
    clock.advance(400);
    const saved = parseSave(kv.peek(PRIMARY_KEY)!);
    expect(saved.ok && saved.value.tasks).toHaveLength(1);

    // 重开：直接是正常房子
    cleanup();
    const again = boot(kv);
    render(<App context={again.ctx} />);
    expect(screen.queryByRole('heading', { name: en['recovery.title'] })).toBeNull();
    expect(again.ctx.store.getState().tasks).toHaveLength(1);
  });

  const stays = (kv: FaultyKv, ctx: AppContext) => {
    expect(screen.getByRole('heading', { name: en['recovery.title'] })).toBeTruthy();
    expect(ctx.store.session.getState().mode).toBe('recovery');
    expect(ctx.store.session.getState().raw).toBe(INVALID_JSON);
    expect(document.querySelector('.house-view')).toBeNull();
    expect(document.querySelector('dialog')).toBeNull();
    expect(screen.queryByText(en['recovery.live.fresh'])).toBeNull();
    for (const name of [COPY, BLANK, FRESH]) expect(button(name)).toBeTruthy();
    void kv;
  };

  const runFresh = () => {
    fireEvent.click(button(FRESH));
    fireEvent.click(within(document.querySelector('dialog')!).getByRole('button', { name: en['recovery.fresh.yes'] }));
  };

  it('备份写入失败：主键一次都没碰，留在恢复界面，温柔提示', () => {
    const kv = faultyKv({ [PRIMARY_KEY]: INVALID_JSON }, { setThrows: (k) => k.startsWith('ub:backup:') });
    const { ctx } = boot(kv);
    render(<App context={ctx} />);
    runFresh();
    expect(screen.getByRole('alert').textContent).toBe(en['recovery.fresh.backupFailed']);
    expect(kv.attempts.some((a) => a.key === PRIMARY_KEY)).toBe(false);
    expect(kv.peek(PRIMARY_KEY)).toBe(INVALID_JSON);
    stays(kv, ctx);
  });

  it('备份读回不一致：同样不碰主键', () => {
    const kv = faultyKv({ [PRIMARY_KEY]: INVALID_JSON }, { getAs: (k, real) => (k.startsWith('ub:backup:') ? `${real}~` : undefined) });
    const { ctx } = boot(kv);
    render(<App context={ctx} />);
    runFresh();
    expect(screen.getByRole('alert').textContent).toBe(en['recovery.fresh.backupFailed']);
    expect(kv.attempts.some((a) => a.key === PRIMARY_KEY)).toBe(false);
    stays(kv, ctx);
  });

  it.each([
    ['写入抛错', { setThrows: (k: string, v: string) => k === PRIMARY_KEY && v !== INVALID_JSON }],
    ['读回抛错', { getAs: (k: string) => (k === PRIMARY_KEY ? ('throw' as const) : undefined) }],
    ['读回为空', { getAs: (k: string) => (k === PRIMARY_KEY ? null : undefined) }],
    ['读回不一致', { getAs: (k: string, real: string | null) => (k === PRIMARY_KEY ? `${real}~` : undefined) }],
  ])('新空存档%s：备份保留，主键尽力还原，不报成功，仍留在恢复界面', (_n, faults) => {
    const kv = faultyKv({ [PRIMARY_KEY]: INVALID_JSON });
    const { ctx } = boot(kv);
    kv.faults = faults; // 启动读完之后才开始出故障
    render(<App context={ctx} />);
    runFresh();
    expect(screen.getByRole('alert').textContent).toBe(en['recovery.fresh.openFailed']);
    expect(kv.peek('ub:backup:1')).toBe(INVALID_JSON);
    expect(kv.peek(PRIMARY_KEY)).toBe(INVALID_JSON);
    stays(kv, ctx);
  });

  it('失败后选项一与二仍可用；失败后的内存继续依然零新增写入', () => {
    const kv = faultyKv({ [PRIMARY_KEY]: INVALID_JSON }, { setThrows: (k) => k.startsWith('ub:backup:') });
    const { ctx, clock } = boot(kv);
    const dl = stubDownload();
    render(<App context={ctx} />);
    runFresh();
    fireEvent.click(button(COPY));
    expect(dl.blobs).toHaveLength(1);
    const attempts = kv.attempts.length;
    fireEvent.click(button(BLANK));
    ctx.store.dispatch({ type: 'CreateTask', title: 'A' });
    ctx.store.flush();
    clock.advance(5000);
    expect(kv.attempts).toHaveLength(attempts);
    expect(kv.peek(PRIMARY_KEY)).toBe(INVALID_JSON);
  });

  it('失败后重试成功：不覆盖旧备份，序号继续递增', () => {
    let failing = true;
    const kv = faultyKv({ [PRIMARY_KEY]: INVALID_JSON }, { setThrows: (k, v) => failing && k === PRIMARY_KEY && v !== INVALID_JSON });
    const { ctx } = boot(kv);
    render(<App context={ctx} />);
    runFresh();
    expect(kv.peek('ub:backup:1')).toBe(INVALID_JSON);
    failing = false;
    runFresh();
    expect(kv.peek('ub:backup:1')).toBe(INVALID_JSON);
    expect(kv.peek('ub:backup:2')).toBe(INVALID_JSON);
    expect(ctx.store.session.getState().mode).toBe('normal');
  });
});

describe('回归：正常存档不受影响', () => {
  it('好存档与没有存档都直接进入房子，没有恢复界面', () => {
    for (const initial of [{} as Record<string, string>, { [PRIMARY_KEY]: JSON.stringify({ schema_version: 1, tasks: [], archive: [], house: { grownFloors: 2, completedCount: 0 }, settings: { lang: 'en' }, nextGhostNo: 1 }) }]) {
      const kv = faultyKv(initial);
      const { ctx } = boot(kv);
      const view = render(<App context={ctx} />);
      expect(screen.queryByRole('heading', { name: en['recovery.title'] })).toBeNull();
      expect(document.querySelector('.house-view')).not.toBeNull();
      expect(kv.attempts).toHaveLength(0);
      view.unmount();
    }
  });
});

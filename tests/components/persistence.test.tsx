// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { App } from '../../src/components/App';
import { PRIMARY_KEY } from '../../src/persistence/keys';
import { parseSave } from '../../src/persistence/parse';
import { createMemoryKv, type MemoryKv } from '../../src/persistence/storage';
import { createPersistentStore } from '../../src/store/bootstrap';
import { createUiStore } from '../../src/store/uiStore';
import { createFakeClock } from '../helpers/clock';
import type { AppContext } from '../../src/store/StoreContext';
import type { Env } from '../../src/domain/types';

const env: Env = { now: () => '2026-11-08T08:00:00.000Z', today: () => '2026-11-08', newId: (() => { let n = 0; return () => `id-${++n}`; })() };

function storageOf(kv: MemoryKv) {
  return { get length() { return kv.keys().length; }, key: (i: number) => kv.keys()[i] ?? null, getItem: (k: string) => kv.getItem(k), setItem: (k: string, v: string) => kv.setItem(k, v) };
}

function makeContext(kv: MemoryKv | null, clock = createFakeClock()): AppContext & { clock: typeof clock } {
  const store = createPersistentStore({ storage: kv ? storageOf(kv) : null, env, clock });
  return { store, ui: createUiStore(), roam: { positionOf: () => null }, clock };
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
  window.location.hash = '';
});

const keepButton = () => screen.getByRole('button', { name: 'Keep a copy' });

describe('页面隐藏时补写', () => {
  it('visibilitychange 变为 hidden 与 pagehide 都会立即写入未保存的变更', () => {
    const kv = createMemoryKv();
    const ctx = makeContext(kv);
    render(<App context={ctx} />);
    ctx.store.dispatch({ type: 'CreateTask', title: 'A' });
    expect(kv.writes).toHaveLength(0);

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(kv.writes).toHaveLength(1);

    ctx.store.dispatch({ type: 'CreateTask', title: 'B' });
    act(() => void window.dispatchEvent(new Event('pagehide')));
    expect(kv.writes).toHaveLength(2);
    const saved = parseSave(kv.getItem(PRIMARY_KEY)!);
    expect(saved.ok && saved.value.tasks.map((t) => t.title)).toEqual(['A', 'B']);
  });

  it('页面重新可见时不写', () => {
    const kv = createMemoryKv();
    const ctx = makeContext(kv);
    render(<App context={ctx} />);
    ctx.store.dispatch({ type: 'CreateTask', title: 'A' });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(kv.writes).toHaveLength(0);
  });

  it('卸载后不再响应隐藏事件', () => {
    const kv = createMemoryKv();
    const ctx = makeContext(kv);
    const view = render(<App context={ctx} />);
    ctx.store.dispatch({ type: 'CreateTask', title: 'A' });
    act(() => view.unmount());
    act(() => void window.dispatchEvent(new Event('pagehide')));
    expect(kv.writes).toHaveLength(0);
  });
});

describe('留一份副本', () => {
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

  it('先出现绘本口吻的说明，点“不用了”什么都不会下载', () => {
    const dl = stubDownload();
    render(<App context={makeContext(createMemoryKv())} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(keepButton());
    const dialog = document.querySelector('dialog')!;
    expect(dialog.textContent).toContain('This keepsake takes all your words with it, titles, steps and notes.');
    expect(dl.blobs).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Not now' }));
    expect(document.querySelector('dialog')).toBeNull();
    expect(dl.blobs).toHaveLength(0);
  });

  it('确认后下载 UTF-8 JSON，内容等于当前存档，文件名带本地日期', async () => {
    const dl = stubDownload();
    const ctx = makeContext(createMemoryKv());
    render(<App context={ctx} />);
    ctx.store.dispatch({ type: 'CreateTask', title: '整理书桌 <b>&</b>' });
    fireEvent.click(keepButton());
    fireEvent.click(within(document.querySelector('dialog')!).getByRole('button', { name: 'Pack the keepsake' }));
    expect(dl.names).toEqual(['unfinished-business-20261108.json']);
    expect(dl.blobs[0]!.type).toContain('application/json');
    const body = await dl.blobs[0]!.text();
    const parsed = parseSave(body);
    expect(parsed.ok && parsed.value).toEqual(ctx.store.getState());
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('下载失败：温柔提示，对话框留着可重试，state 不变', () => {
    stubDownload();
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      throw new Error('nope');
    });
    const ctx = makeContext(createMemoryKv());
    render(<App context={ctx} />);
    ctx.store.dispatch({ type: 'CreateTask', title: 'A' });
    const before = ctx.store.getState();
    fireEvent.click(keepButton());
    fireEvent.click(within(document.querySelector('dialog')!).getByRole('button', { name: 'Pack the keepsake' }));
    expect(screen.getByRole('alert').textContent).toContain("wouldn't leave the house");
    expect(document.querySelector('dialog')).not.toBeNull();
    expect(ctx.store.getState()).toBe(before);
  });

  it('页面上没有任何导入入口', () => {
    render(<App context={makeContext(createMemoryKv())} />);
    expect(document.querySelector('input[type="file"]')).toBeNull();
    const labels = [...document.querySelectorAll('button, a, label')].map((e) => e.textContent ?? '');
    expect(labels.join('|')).not.toMatch(/import|upload|restore|load/i);
  });
});

describe('收不起来时的提示', () => {
  it('正常时没有提示，入口低调', () => {
    render(<App context={makeContext(createMemoryKv())} />);
    expect(document.querySelector('.storage-notice')).toBeNull();
    expect(keepButton().className).not.toContain('loud');
  });

  it('写满之后提示出现、入口变醒目，导出仍然可用', () => {
    const kv = createMemoryKv();
    const ctx = makeContext(kv);
    render(<App context={ctx} />);
    kv.failWrites(true);
    act(() => {
      ctx.store.dispatch({ type: 'CreateTask', title: 'A' });
      ctx.clock.advance(300);
    });
    expect(screen.getByText("I couldn't tuck things away this time. Keep a copy so nothing gets lost.")).toBeTruthy();
    expect(keepButton().className).toContain('loud');
    expect(ctx.store.getState().tasks).toHaveLength(1);
    fireEvent.click(keepButton());
    expect(document.querySelector('dialog')).not.toBeNull();
  });

  it('存储不可用，或读到坏存档后选择空白页继续时，提示这一次不会被收起来，且不出现键名与内部标识', () => {
    const cases: [MemoryKv | null, string][] = [
      [null, "I couldn't tuck things away this time. Keep a copy so nothing gets lost."],
      [createMemoryKv({ [PRIMARY_KEY]: '{oops' }), 'Just for now: nothing will be tucked away this time.'],
    ];
    for (const [kv, message] of cases) {
      const view = render(<App context={makeContext(kv)} />);
      // 坏存档先停在恢复界面，玩家主动选了空白页，才进入房子
      if (kv) fireEvent.click(screen.getByRole('button', { name: 'Carry on with a blank page' }));
      expect(screen.getByText(message)).toBeTruthy();
      expect(keepButton().className).toContain('loud');
      expect(document.body.textContent).not.toMatch(/ub:|schema|localStorage|oops/);
      act(() => view.unmount());
    }
  });
});

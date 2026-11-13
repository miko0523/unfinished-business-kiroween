// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/preact';
import { App } from '../../src/components/App';
import { createStore } from '../../src/store/store';
import { createUiStore } from '../../src/store/uiStore';
import { createMemoryPort } from '../../src/store/storagePort';
import { browserEnv } from '../../src/store/env';
import type { AppContext } from '../../src/store/StoreContext';

function makeContext(): AppContext {
  return { store: createStore({ env: browserEnv(), port: createMemoryPort() }), ui: createUiStore(), roam: { positionOf: () => null } };
}

function setViewport(w: number, h: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
  window.dispatchEvent(new Event('resize'));
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  setViewport(390, 664);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('镜头只在看得见旧宅时滚动', () => {
  it('手机在纪念册里，Safari 地址栏收起导致视口变高时，不把页面往回推', async () => {
    window.history.replaceState(null, '', '/#/archive');
    render(<App context={makeContext()} />);
    const scrollBy = vi.fn();
    window.scrollBy = scrollBy as typeof window.scrollBy;
    await act(async () => setViewport(390, 750));
    await act(async () => setViewport(390, 664));
    expect(document.querySelector('.house-view')?.hasAttribute('hidden')).toBe(true);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('回到旧宅后，视口变高时镜头照常把当前楼层滚进视口', async () => {
    render(<App context={makeContext()} />);
    const scrollBy = vi.fn();
    window.scrollBy = scrollBy as typeof window.scrollBy;
    const house = document.querySelector<HTMLElement>('.house')!;
    house.getBoundingClientRect = () => ({ top: -900, bottom: 400, left: 0, right: 390, width: 390, height: 1300, x: 0, y: -900, toJSON() {} }) as DOMRect;
    await act(async () => setViewport(390, 750));
    expect(scrollBy).toHaveBeenCalled();
  });
});

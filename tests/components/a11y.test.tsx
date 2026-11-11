// @vitest-environment happy-dom
import { useState } from 'preact/hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { App } from '../../src/components/App';
import { hitHalfUnits } from '../../src/components/ResidentLayer';
import { layoutHouse } from '../../src/house/layout';
import { Dialog } from '../../src/components/Dialog';
import { canHoldFocus, fallbackTarget, settleFocus } from '../../src/components/focusFallback';
import { LiveRegion, CAPTION_MS } from '../../src/components/LiveRegion';
import { announce } from '../../src/store/announce';
import { emptyState, type Env } from '../../src/domain/types';
import { createStore } from '../../src/store/store';
import { createUiStore } from '../../src/store/uiStore';
import { en } from '../../src/i18n/en';
import { zhCN } from '../../src/i18n/zh-CN';
import { forLanguage } from '../../src/i18n/t';

// Automated structure checks in happy-dom. They check the DOM tree and names; they are not a screen-reader session.

const env: Env = { now: () => '2026-11-09T08:00:00.000Z', today: () => '2026-11-09', newId: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })() };
const boot = () => {
  const store = createStore({ env });
  return { store, ui: createUiStore(), roam: { positionOf: () => null } };
};

beforeEach(() => {
  // happy-dom lays nothing out; pretend every attached element has a box so "visible" checks are meaningful.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.isConnected ? [{}] : []) as unknown as DOMRectList;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); window.location.hash = ''; });

describe('semantic landmarks and focus order in the DOM', () => {
  it('has one banner, one main with the house, one footer navigation, and exactly one h1', () => {
    render(<App context={boot()} />);
    expect(document.querySelectorAll('header')).toHaveLength(1);
    expect(document.querySelectorAll('main')).toHaveLength(1);
    expect(document.querySelectorAll('footer')).toHaveLength(1);
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(document.querySelector('header')!.parentElement?.closest('main')).toBeNull();
    const nav = screen.getByRole('navigation', { name: en['footer.nav'] });
    expect(nav.closest('footer')).not.toBeNull();
    expect(within(nav).getByRole('link', { name: en['lobby.archive'] }).getAttribute('href')).toBe('#/archive');
    expect(document.querySelector('main .house')).not.toBeNull();
    expect(document.querySelector('main')!.contains(document.querySelector('header'))).toBe(false);
  });

  it('keeps DOM order = tab order: header, create form, residents, lobby book, details card, archive entry', () => {
    render(<App context={boot()} />);
    for (const title of ['A', 'B', 'C']) {
      fireEvent.input(screen.getByLabelText(en['create.label']), { target: { value: title } });
      fireEvent.click(screen.getByRole('button', { name: en['create.submit'] }));
    }
    fireEvent.click(document.querySelector<HTMLElement>('[data-ghost]')!);
    const order = [...document.querySelectorAll<HTMLElement>('button, a[href], input, textarea')].filter((el) => el.tabIndex >= 0);
    const at = (predicate: (el: HTMLElement) => boolean) => order.findIndex(predicate);
    const lang = at((el) => el.closest('.lang-switch') !== null);
    const create = at((el) => el.id === 'create-title');
    const ghost = at((el) => el.hasAttribute('data-ghost'));
    const book = at((el) => el.classList.contains('archive-book'));
    const card = at((el) => el.closest('.task-card') !== null);
    const footer = at((el) => el.classList.contains('footer-link'));
    expect(lang).toBeGreaterThanOrEqual(0);
    expect(lang).toBeLessThan(create);
    expect(create).toBeLessThan(ghost);
    expect(ghost).toBeLessThan(book);
    expect(book).toBeLessThan(card);
    expect(card).toBeLessThan(footer);
    expect(footer).toBe(order.length - 1);
    // Residents: floors high to low, same floor left to right.
    const ghosts = order.filter((el) => el.hasAttribute('data-ghost')).map((el) => [Number(el.dataset.floor), Number(el.dataset.slot)]);
    expect(ghosts).toEqual([...ghosts].sort((a, b) => b[0]! - a[0]! || a[1]! - b[1]!));
  });

  it('gives each resident exactly one button with a unique accessible name', () => {
    render(<App context={boot()} />);
    for (const title of ['A', 'B', 'C']) {
      fireEvent.input(screen.getByLabelText(en['create.label']), { target: { value: title } });
      fireEvent.click(screen.getByRole('button', { name: en['create.submit'] }));
    }
    const buttons = [...document.querySelectorAll<HTMLElement>('[data-ghost]')];
    expect(buttons).toHaveLength(3);
    expect(buttons.every((b) => b.tagName === 'BUTTON' && b.getAttribute('type') === 'button' && b.querySelector('button, a, input, [tabindex]') === null)).toBe(true);
    expect(new Set(buttons.map((b) => b.getAttribute('aria-label'))).size).toBe(3);
    expect(document.querySelectorAll('.residents button')).toHaveLength(3);
  });
});

describe('dialog focus: in, trapped, back, and a safe place when the trigger is gone', () => {
  function Harness({ removeTrigger }: { removeTrigger?: boolean }) {
    const [open, setOpen] = useState(false);
    return (
      <div>
        <h1 tabIndex={-1}>Title</h1>
        <input id="create-title" />
        {removeTrigger && open ? null : <button id="trigger" onClick={() => setOpen(true)}>Open</button>}
        {open ? (
          <Dialog labelledBy="d-title" onClose={() => setOpen(false)}>
            <h2 id="d-title">Dialog</h2>
            <button id="first">One</button>
            <button id="last">Two</button>
          </Dialog>
        ) : null}
      </div>
    );
  }

  it('moves focus in, wraps Tab at both ends, and returns to the trigger on Escape', () => {
    render(<Harness />);
    const trigger = document.getElementById('trigger')!;
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.activeElement?.id).toBe('first');
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement?.id).toBe('last');
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(document.activeElement?.id).toBe('first');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.activeElement?.id).toBe('trigger');
  });

  it('falls back to the create field, then to the h1, when the trigger no longer exists', () => {
    vi.useFakeTimers();
    render(<Harness removeTrigger />);
    document.getElementById('trigger')!.focus();
    fireEvent.click(document.getElementById('trigger')!);
    expect(document.getElementById('trigger')).toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    act(() => { vi.runAllTimers(); });
    expect(document.activeElement?.id).toBe('create-title');

    // No create field on the page (e.g. the archive route): the page title takes it.
    document.getElementById('create-title')!.remove();
    (document.activeElement as HTMLElement | null)?.blur();
    settleFocus();
    act(() => { vi.runAllTimers(); });
    expect(document.activeElement?.tagName).toBe('H1');
  });

  it('knows what can hold focus', () => {
    render(<div><button id="ok">ok</button><button id="off" disabled>off</button><div hidden><button id="hid">hid</button></div></div>);
    expect(canHoldFocus(document.getElementById('ok'))).toBe(true);
    expect(canHoldFocus(document.getElementById('off'))).toBe(false);
    expect(canHoldFocus(document.getElementById('hid'))).toBe(false);
    expect(canHoldFocus(null)).toBe(false);
    expect(fallbackTarget()).toBeNull();
  });
});

describe('live region', () => {
  it('stays one polite status element and shows a visible caption only while the system asks for reduced motion', () => {
    vi.useFakeTimers();
    let reduce = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() { return reduce && query.includes('reduce'); },
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }));
    const view = render(<LiveRegion message="Swept the floor." />);
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.className).toContain('visually-hidden');
    expect(status.getAttribute('data-caption')).toBe('false');
    // The system flips to reduce while the text is still new: the same element becomes visible text.
    reduce = true;
    act(() => { listeners.forEach((fn) => fn()); });
    expect(screen.getByRole('status')).toBe(status);
    expect(status.getAttribute('data-caption')).toBe('true');
    expect(status.className).not.toContain('visually-hidden');
    expect(status.textContent).toBe('Swept the floor.');
    act(() => { vi.advanceTimersByTime(CAPTION_MS + 1); });
    expect(status.getAttribute('data-caption')).toBe('false');
    expect(status.textContent).toBe('Swept the floor.');
    view.unmount();
    vi.unstubAllGlobals();
  });
});

describe('announcements cover state changes, undo, pending, lamp and farewell in both languages', () => {
  it('translates every announced event kind', () => {
    for (const lang of ['en', 'zh-CN'] as const) {
      const t = forLanguage(lang);
      const table = lang === 'en' ? en : zhCN;
      const store = createStore({ env, initial: { ...emptyState(), settings: { lang } } });
      store.dispatch({ type: 'CreateTask', title: 'T' });
      const id = store.getState().tasks[0]!.id;
      store.dispatch({ type: 'SetCriteria', taskId: id, criteria: 'done' });
      const added = store.dispatch({ type: 'AddStep', taskId: id, title: 'S' });
      expect(announce(added.events, store.getState())).toContain(t('live.state', { state: t('state.white') }));
      const stepId = store.getState().tasks[0]!.steps[0]!.id;
      const checked = store.dispatch({ type: 'ToggleStep', taskId: id, stepId });
      const text = announce(checked.events, store.getState());
      expect(text).toContain(t('live.state', { state: t('state.pending') }));
      const unchecked = store.dispatch({ type: 'ToggleStep', taskId: id, stepId });
      expect(announce(unchecked.events, store.getState())).toContain(t('live.erase', { done: 0, total: 1 }));
      store.dispatch({ type: 'ToggleStep', taskId: id, stepId });
      store.dispatch({ type: 'BeginConfirm', taskId: id });
      const confirmed = store.dispatch({ type: 'ConfirmComplete', taskId: id, memo: '' });
      const finale = announce(confirmed.events, store.getState());
      expect(finale).toContain(t('live.flew'));
      expect(finale).toContain(t('live.lamp'));
      expect(table['live.farewellDone']).toContain(table['live.flew'].replace(/[.。]$/, ''));
      expect(table['live.farewellDone'].length).toBeGreaterThan(0);
    }
  });
});

describe('ghost hit areas share the midline between the two home anchors', () => {
  it('uses the same half distance for both slots of a floor, and it is the real anchor gap', () => {
    for (const grown of [2, 3, 6] as const) {
      const layout = layoutHouse(grown);
      for (let floor = 2; floor <= Math.min(grown, 6); floor++) {
        const left = hitHalfUnits(layout, { floor: floor as 2, slot: 0 });
        const right = hitHalfUnits(layout, { floor: floor as 2, slot: 1 });
        expect(left).toBe(right);
        expect(left).toBeGreaterThan(40);
        expect(left).toBeLessThan(200);
      }
    }
  });
});

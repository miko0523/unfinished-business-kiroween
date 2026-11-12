// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/preact';
import fc from 'fast-check';
import { App } from '../../src/components/App';
import { emptyState, type AppState, type Env } from '../../src/domain/types';
import { createStore } from '../../src/store/store';
import { createUiStore } from '../../src/store/uiStore';

const env: Env = { now: () => '2026-11-09T08:00:00.000Z', today: () => '2026-11-09', newId: () => 'id-x' };

/** 带着 Task_Title、criteria、Step 标题与 memo 的同一段文字。 */
function stateWith(text: string): AppState {
  return {
    ...emptyState(),
    tasks: [{ id: 't1', ghostNo: 1, title: text, criteria: text, steps: [{ id: 's1', title: text, done: false }], slot: { floor: 2, slot: 0 }, createdAt: env.now() }],
    archive: [{ id: 'e1', title: text, titleVisible: true, completedOn: '2026-11-09', stepCount: 1, memo: text, confirmedAt: env.now() }],
    house: { grownFloors: 2, completedCount: 1 },
    nextGhostNo: 2,
  };
}

const view = (text: string) => render(<App context={{ store: createStore({ env, initial: stateWith(text) }), ui: createUiStore(), roam: { positionOf: () => null } }} />);

/** 页面上所有元素的标签计数，用来证明文字没有被解析成额外的元素。 */
const shape = (root: ParentNode) => {
  const counts = new Map<string, number>();
  for (const el of root.querySelectorAll('*')) counts.set(el.tagName, (counts.get(el.tagName) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => a.localeCompare(b));
};

const NASTY = ['<', '>', '&', '"', "'", '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<svg onload=1>', '<b>x</b>', '&amp;', '</div>', '`'];
const textArb = fc
  .tuple(fc.string({ maxLength: 6 }), fc.array(fc.constantFrom(...NASTY), { minLength: 1, maxLength: 3 }), fc.string({ maxLength: 6 }))
  .map(([a, bits, b]) => `${a}${bits.join('')}${b}`.slice(0, 60).trim())
  .filter((s) => s.length > 0);

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('Feature: unfinished-business, Property 19: 渲染文本不解释 HTML', () => {
  it('Task_Title、criteria、Step 标题与 memo 里的 < > & 引号、script、img onerror 都作为文字出现，不产生额外元素或事件属性', () => {
    window.location.hash = '';
    const plainHouse = view('plain');
    fireEvent.click(plainHouse.container.querySelector<HTMLElement>('[data-ghost]')!);
    const houseShape = shape(plainHouse.container);
    plainHouse.unmount();
    window.location.hash = '#/archive';
    const plainArchive = view('plain');
    const archiveShape = shape(plainArchive.container);
    plainArchive.unmount();

    fc.assert(
      fc.property(textArb, (text) => {
        window.location.hash = '';
        const house = view(text);
        const ghost = house.container.querySelector<HTMLElement>('[data-ghost]')!;
        expect(ghost.getAttribute('aria-label')).toContain(text);
        fireEvent.click(ghost);
        const card = house.container.querySelector<HTMLElement>('aside.task-card')!;
        expect(within(card).getByRole('heading', { level: 2 }).textContent).toBe(text);
        expect(card.querySelector('.criteria-text')!.textContent).toBe(text);
        const checkbox = card.querySelector<HTMLInputElement>('input[type="checkbox"]');
        expect(checkbox).not.toBeNull();
        expect(checkbox!.closest('label')!.querySelector('span')!.textContent).toBe(text);
        expect(shape(house.container)).toEqual(houseShape);
        expect(house.container.querySelector('script')).toBeNull();
        expect(house.container.querySelectorAll('[onerror],[onload]')).toHaveLength(0);
        house.unmount();

        window.location.hash = '#/archive';
        const archiveView = view(text);
        const archive = archiveView.container.querySelector('.archive')!;
        expect(archive.querySelector('.archive-memo')!.textContent).toBe(text);
        expect(archive.querySelector('.archive-title-line')!.textContent).toBe(text);
        expect(shape(archiveView.container)).toEqual(archiveShape);
        expect(archiveView.container.querySelectorAll('[onerror],[onload]')).toHaveLength(0);
        archiveView.unmount();
      }),
      { numRuns: 100 },
    );
    // 每轮渲染整页 App：单独跑约 1.8 秒，全量并行时在负载下曾超过默认的 5 秒（阶段 18 页头多了声音开关）；给 10 秒。
  }, 10_000);
});

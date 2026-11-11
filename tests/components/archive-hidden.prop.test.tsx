// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import fc from 'fast-check';
import { App } from '../../src/components/App';
import { emptyState, type AppState, type Env } from '../../src/domain/types';
import { createStore } from '../../src/store/store';
import { createUiStore } from '../../src/store/uiStore';

const env: Env = { now: () => '2026-11-09T08:00:00.000Z', today: () => '2026-11-09', newId: () => 'id-x' };

const stateWith = (title: string, titleVisible = false): AppState => ({
  ...emptyState(),
  archive: [{ id: 'e1', title, titleVisible, completedOn: '2026-11-09', stepCount: 2, memo: '', confirmedAt: env.now() }],
  house: { grownFloors: 2, completedCount: 1 },
  nextGhostNo: 2,
});

/** 页面上玩家（或读屏、浏览器）能碰到的一切文字：正文、标签、标题、地址。 */
function everything(): string {
  const attrs = [...document.querySelectorAll('*')].flatMap((el) => [...el.attributes].map((a) => a.value));
  return [document.body.textContent, document.title, window.location.href, window.location.hash, ...attrs].join('\n');
}

function open(title: string, visible = false) {
  window.location.hash = '#/archive';
  return render(<App context={{ store: createStore({ env, initial: stateWith(title, visible) }), ui: createUiStore(), roam: { positionOf: () => null } }} />);
}

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('Feature: unfinished-business, Property 13: 隐藏标题不泄露', () => {
  it('titleVisible=false 时，纪念册的可见文本、aria、title、页面标题与地址都不含该标题；显示后再隐藏同样不含', () => {
    open('placeholder');
    const baseline = everything();
    cleanup();

    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', minLength: 4, maxLength: 40 }), (raw) => {
        const title = raw.trim();
        // 标题恰好是界面本来就有的字（如 “Back to the house”的片段）不算泄露：先排除。
        fc.pre(title.length >= 4 && !baseline.includes(title));
        open(title);
        expect(everything()).not.toContain(title);

        // 玩家选择显示：标题出现；再隐藏：标题又消失（选择会被保存，但隐藏态不泄露）。
        const toggle = () => document.querySelector<HTMLElement>('.archive-title-toggle')!;
        fireEvent.click(toggle());
        expect(everything()).toContain(title);
        act(() => {
          fireEvent.click(toggle());
        });
        expect(everything()).not.toContain(title);
        cleanup();
      }),
      { numRuns: 100 },
    );
  });
});

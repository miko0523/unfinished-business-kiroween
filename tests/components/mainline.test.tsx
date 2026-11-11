// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import fc from 'fast-check';
import { App } from '../../src/components/App';
import { createStore } from '../../src/store/store';
import { createUiStore } from '../../src/store/uiStore';
import { createMemoryPort } from '../../src/store/storagePort';
import { browserEnv } from '../../src/store/env';
import type { AppContext } from '../../src/store/StoreContext';

beforeEach(() => {
  window.location.hash = '';
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.location.hash = '';
});

function makeContext(): AppContext & { port: ReturnType<typeof createMemoryPort> } {
  const port = createMemoryPort();
  return { store: createStore({ env: browserEnv(), port }), ui: createUiStore(), roam: { positionOf: () => null }, port };
}

const type = (label: RegExp | string, value: string, scope: HTMLElement | Document = document.body) =>
  fireEvent.input(within(scope as HTMLElement).getByLabelText(label), { target: { value } });
const click = (name: RegExp | string, scope: HTMLElement | Document = document.body) =>
  fireEvent.click(within(scope as HTMLElement).getByRole('button', { name }));

function create(title: string) {
  type(/still waiting/i, title);
  click(/welcome a little ghost/i);
}
const ghost = () => document.querySelector<HTMLElement>('[data-ghost]')!;
const card = () => screen.getByRole('complementary', { name: /details/i });

function openCard(title = 'Tidy the desk') {
  create(title);
  fireEvent.click(ghost());
  return card();
}

function clarify(steps: string[]) {
  type(/what does/i, 'The desk is clear', card());
  click(/^save$/i, card());
  for (const s of steps) {
    type(/add a small step/i, s, card());
    click(/add step/i, card());
  }
}

function checkAll() {
  for (const box of within(card()).getAllByRole('checkbox')) if (!(box as HTMLInputElement).checked) fireEvent.click(box);
}

describe('详情卡与完成条件', () => {
  it('点击 Ghost 打开详情卡，焦点到标题；显示状态文字与“X of Y done”；提示还缺什么', () => {
    render(<App />);
    openCard();
    expect(document.activeElement).toBe(within(card()).getByRole('heading', { name: 'Tidy the desk' }));
    expect(card().textContent).toContain('Not clear yet');
    expect(card().textContent).not.toContain('0 of 0');
    expect(card().textContent).toMatch(/what "done" looks like, and add a first small step/);
  });

  it('只填完成条件或只加步骤都仍是灰色；两者具备后变白', () => {
    render(<App />);
    openCard();
    type(/what does/i, 'Clear', card());
    click(/^save$/i, card());
    expect(ghost().dataset.state).toBe('gray');
    expect(card().textContent).toMatch(/add a first small step/);
    click('Edit', card());
    type(/what does/i, '', card());
    click(/^save$/i, card());
    type(/add a small step/i, 'one', card());
    click(/add step/i, card());
    expect(ghost().dataset.state).toBe('gray');
    expect(card().textContent).toMatch(/done" look like/);
    type(/what does/i, 'Clear', card());
    click(/^save$/i, card());
    expect(ghost().dataset.state).toBe('white');
    expect(ghost().getAttribute('aria-label')).toContain('Ready to start');
    expect(screen.getByRole('status').textContent).toContain('Now: Ready to start.');
  });

  it('回归：完成条件为空而步骤全勾 → 灰色、疑惑、不可确认；保存完成条件后立即变绿并可确认', () => {
    vi.useFakeTimers();
    render(<App />);
    openCard();
    type(/add a small step/i, 'one', card());
    click(/add step/i, card());
    fireEvent.click(within(card()).getByRole('checkbox'));
    act(() => void vi.advanceTimersByTime(4000)); // 等家务动画播完，回到静止表情
    expect(ghost().dataset.state).toBe('gray');
    expect(ghost().dataset.pending).toBe('false');
    expect(ghost().getAttribute('aria-label')).toContain('Not clear yet');
    expect(ghost().querySelector('.ghost-eyes')!.getAttribute('data-expression')).toBe('puzzled');
    expect(ghost().querySelector('.ghost-ring, .ghost-medal')).toBeNull();
    expect(card().textContent).toContain('One last thing: what does done look like?');
    expect(card().textContent).not.toContain('Ready to confirm');
    expect(within(card()).queryByRole('button', { name: /confirm complete/i })).toBeNull();
    expect(card().querySelector('.criteria')!.getAttribute('data-needs-criteria')).toBe('true');
    type(/what does/i, 'Clear', card());
    click(/^save$/i, card());
    expect(ghost().dataset.state).toBe('green');
    expect(ghost().dataset.pending).toBe('true');
    expect(card().textContent).toContain('Ready to confirm');
    expect(card().textContent).not.toContain('One last thing');
    expect(within(card()).getByRole('button', { name: /confirm complete/i })).toBeTruthy();
  });

  it('完成条件超过 200 字：拒绝保存并显示字符数', () => {
    render(<App />);
    openCard();
    type(/what does/i, 'y'.repeat(201), card());
    click(/^save$/i, card());
    expect(within(card()).getByRole('alert').textContent).toContain('201');
    expect(within(card()).getByRole('alert').textContent).toContain('200');
    expect(card().textContent).toContain('201/200');
    expect(ghost().dataset.state).toBe('gray');
  });

  it('关闭只通过关闭按钮与 Esc；点卡外的空白不关；关闭后焦点回到 Ghost', () => {
    render(<App />);
    openCard();
    fireEvent.click(document.body);
    fireEvent.click(document.querySelector('.house')!);
    expect(screen.queryByRole('complementary')).not.toBeNull();
    fireEvent.keyDown(card(), { key: 'Escape' });
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(document.activeElement).toBe(ghost());
    fireEvent.click(ghost());
    click(/^close$/i, card());
    expect(screen.queryByRole('complementary')).toBeNull();
  });
});

describe('步骤', () => {
  it('空、81 字、第 51 步：拒绝并说明', () => {
    render(<App />);
    openCard();
    type(/add a small step/i, '   ', card());
    click(/add step/i, card());
    expect(within(card()).getByRole('alert').textContent).toMatch(/between 1 and 80/);
    type(/add a small step/i, 'x'.repeat(81), card());
    click(/add step/i, card());
    expect(within(card()).getByRole('alert').textContent).toContain('81');
    for (let i = 0; i < 50; i++) {
      type(/add a small step/i, `s${i}`, card());
      click(/add step/i, card());
    }
    expect(within(card()).getAllByRole('checkbox')).toHaveLength(50);
    type(/add a small step/i, 'one too many', card());
    click(/add step/i, card());
    expect(within(card()).getByRole('alert').textContent).toMatch(/50/);
    expect(within(card()).getAllByRole('checkbox')).toHaveLength(50);
  });

  it('编辑、上移、下移、删除；首尾的移动按钮不可用', () => {
    render(<App />);
    openCard();
    for (const s of ['a', 'b', 'c']) {
      type(/add a small step/i, s, card());
      click(/add step/i, card());
    }
    const order = () => within(card()).getAllByRole('checkbox').map((c) => c.parentElement!.textContent);
    expect(order()).toEqual(['a', 'b', 'c']);
    expect((within(card()).getByRole('button', { name: 'Move up: a' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(card()).getByRole('button', { name: 'Move down: c' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(card()).getByRole('checkbox', { name: 'a' }));
    click('Move down: a', card());
    expect(order()).toEqual(['b', 'a', 'c']);
    expect((within(card()).getByRole('checkbox', { name: 'a' }) as HTMLInputElement).checked).toBe(true);
    expect((within(card()).getByRole('checkbox', { name: 'b' }) as HTMLInputElement).checked).toBe(false);
    click('Move up: c', card());
    expect(order()).toEqual(['b', 'c', 'a']);
    click('Edit: c', card());
    type(/step words/i, '  cc  ', card());
    click(/^save step$/i, card());
    expect(order()).toEqual(['b', 'cc', 'a']);
    click('Remove: b', card());
    expect(order()).toEqual(['cc', 'a']);
  });

  it('编辑时空标题被拒并显示说明，保持在编辑状态', () => {
    render(<App />);
    openCard();
    type(/add a small step/i, 'a', card());
    click(/add step/i, card());
    click('Edit: a', card());
    type(/step words/i, '', card());
    click(/^save step$/i, card());
    expect(within(card()).getByRole('alert').textContent).toMatch(/between 1 and 80/);
    expect(within(card()).queryByLabelText(/step words/i)).not.toBeNull();
  });
});

describe('勾选、等确认与橡皮擦', () => {
  it('全部完成后保持绿色，显示“Ready to confirm”、金边与确认按钮；不会自己变金', () => {
    render(<App />);
    openCard();
    clarify(['a', 'b']);
    checkAll();
    expect(ghost().dataset.state).toBe('green');
    expect(ghost().dataset.pending).toBe('true');
    expect(ghost().getAttribute('aria-label')).toContain('Ready to confirm');
    expect(ghost().querySelector('.ghost-ring')).not.toBeNull();
    expect(card().textContent).toContain('Ready to confirm');
    expect(within(card()).queryByRole('button', { name: 'Confirm complete' })).not.toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Now: Ready to confirm.');
    expect(document.body.textContent).not.toMatch(/streak|overdue|countdown|hurry/i);
  });

  it('取消勾选：进度如实回退，温柔文案与播报，等确认的标记一并消失', () => {
    render(<App />);
    openCard();
    clarify(['a', 'b']);
    checkAll();
    fireEvent.click(within(card()).getByRole('checkbox', { name: 'b' }));
    expect(ghost().dataset.pending).toBe('false');
    expect(ghost().dataset.state).toBe('green');
    expect(ghost().dataset.anim).toBe('erase');
    expect(ghost().querySelector('.ghost-ring')).toBeNull();
    expect(within(card()).queryByRole('button', { name: 'Confirm complete' })).toBeNull();
    expect(card().textContent).toContain('1 of 2 done');
    expect(screen.getByRole('status').textContent).toBe('Oops, let me fix that. 1 of 2 done.');
    fireEvent.click(within(card()).getByRole('checkbox', { name: 'a' }));
    expect(ghost().dataset.state).toBe('white');
  });

  it('1 步和 2 步的 Task 同样有家务反馈', () => {
    for (const n of [1, 2]) {
      cleanup();
      render(<App />);
      openCard();
      clarify(Array.from({ length: n }, (_, i) => `s${i}`));
      fireEvent.click(within(card()).getAllByRole('checkbox')[0]!);
      expect(screen.getByRole('status').textContent).toContain('Swept the floor.');
      expect(ghost().dataset.state).toBe('green');
    }
  });
});

describe('确认对话框', () => {
  function pending(ctx = makeContext()) {
    render(<App context={ctx} />);
    openCard();
    clarify(['a']);
    checkAll();
    return ctx;
  }

  it('打开时焦点移入，Tab 循环；Esc 与“再想想”保持不变并让焦点回到按钮', () => {
    pending();
    const confirmButton = within(card()).getByRole('button', { name: 'Confirm complete' });
    confirmButton.focus();
    fireEvent.click(confirmButton);
    const dialog = screen.getByRole('dialog', { hidden: true });
    const items = [...dialog.querySelectorAll<HTMLElement>('button, textarea')];
    expect(dialog.contains(document.activeElement)).toBe(true);
    items[items.length - 1]!.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(items[items.length - 1]);

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(document.querySelector('dialog')).toBeNull();
    expect(ghost().dataset.pending).toBe('true');
    expect(document.activeElement).toBe(confirmButton);

    fireEvent.click(confirmButton);
    click(/let me think again/i, document.querySelector('dialog') as HTMLElement);
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(confirmButton);
    expect(document.querySelector('[data-ghost]')).not.toBeNull();
  });

  it('留言 141 字被拒；留空可以确认', () => {
    const ctx = pending();
    click('Confirm complete', card());
    const dialog = () => document.querySelector('dialog') as HTMLElement;
    type(/little note/i, 'm'.repeat(141), dialog());
    click('Confirm complete', dialog());
    expect(within(dialog()).getByRole('alert').textContent).toContain('141');
    expect(ctx.store.getState().archive).toHaveLength(0);
    type(/little note/i, '', dialog());
    click('Confirm complete', dialog());
    expect(ctx.store.getState().archive).toHaveLength(1);
    expect(ctx.store.getState().archive[0]!.memo).toBe('');
  });

  it('写入失败：保持未确认、不播放庆祝、对话框保持打开并提示可重试；恢复后可以重试', () => {
    const ctx = pending();
    click('Confirm complete', card());
    const dialog = () => document.querySelector('dialog') as HTMLElement;
    ctx.port.failWith('readback-differs');
    click('Confirm complete', dialog());
    expect(within(dialog()).getByRole('alert').textContent).toMatch(/stamp didn't land/);
    expect(ctx.store.getState().tasks).toHaveLength(1);
    expect(ctx.store.getState().archive).toHaveLength(0);
    expect(document.querySelector('.celebration')).toBeNull();
    expect(ghost().dataset.state).toBe('green');
    ctx.port.failWith(null);
    click('Confirm complete', dialog());
    expect(ctx.store.getState().archive).toHaveLength(1);
  });
});

describe('庆祝、跳过、暖灯与纪念册', () => {
  function confirmOne(memo = '') {
    const ctx = makeContext();
    render(<App context={ctx} />);
    openCard('Secret plan');
    clarify(['a', 'b', 'c']);
    checkAll();
    click('Confirm complete', card());
    const dialog = document.querySelector('dialog') as HTMLElement;
    type(/little note/i, memo, dialog);
    click('Confirm complete', dialog);
    return ctx;
  }

  it('确认后数据立即是最终状态；序列依次变金、挥手、盖章、飞进，4.6 秒内结束，暖灯在最后点亮', () => {
    vi.useFakeTimers();
    const ctx = confirmOne('So proud');
    expect(ctx.store.getState().archive).toHaveLength(1);
    expect(document.querySelector('[data-ghost]')).toBeNull();
    const phase = () => document.querySelector('.celebration')?.getAttribute('data-phase');
    const lamps = () => document.querySelectorAll('.warm-lamp').length;
    act(() => void vi.advanceTimersByTime(10));
    expect(phase()).toBe('gold');
    expect(lamps()).toBe(0);
    act(() => void vi.advanceTimersByTime(1000));
    expect(phase()).toBe('wave');
    act(() => void vi.advanceTimersByTime(900));
    expect(phase()).toBe('stamp');
    const stamp = document.querySelector('.stamp-page')!.textContent!;
    expect(stamp).toMatch(/^A little ghost, complete on \d{4}-\d{2}-\d{2}/);
    expect(stamp).not.toContain('Steps done');
    expect(document.querySelector('.stamp-page .stamp-seal')).not.toBeNull();
    expect(stamp).toContain('So proud');
    expect(stamp).not.toContain('Secret plan');
    act(() => void vi.advanceTimersByTime(900));
    expect(phase()).toBe('fly');
    expect(lamps()).toBe(0);
    act(() => void vi.advanceTimersByTime(1400));
    expect(lamps()).toBe(1);
    act(() => void vi.advanceTimersByTime(400));
    expect(document.querySelector('.celebration')).toBeNull();
    expect(lamps()).toBe(1);
    expect(screen.getByRole('status').textContent).toContain('flew into the Archive');
  });

  it('“跳过动画”随时直接显示稳态：庆祝层消失、暖灯已亮、纪念册已有 Entry', () => {
    vi.useFakeTimers();
    const ctx = confirmOne();
    act(() => void vi.advanceTimersByTime(1200));
    expect(document.querySelector('.celebration')).not.toBeNull();
    click('Skip animation');
    expect(document.querySelector('.celebration')).toBeNull();
    expect(document.querySelectorAll('.warm-lamp')).toHaveLength(1);
    expect(ctx.store.getState().archive).toHaveLength(1);
    expect(ctx.ui.getState().celebration).toBeNull();
  });

  it('纪念册：由新到旧；标题默认隐藏，可逐条显示与再次隐藏；内部编号不外露', () => {
    vi.useFakeTimers();
    const ctx = confirmOne('first memo');
    act(() => void vi.advanceTimersByTime(10));
    click('Skip animation');
    // 再送走第二只
    create('Second secret');
    fireEvent.click(document.querySelector('[data-ghost]')!);
    clarify(['x']);
    checkAll();
    click('Confirm complete', card());
    click('Confirm complete', document.querySelector('dialog') as HTMLElement);
    act(() => void vi.advanceTimersByTime(10));
    click('Skip animation');
    expect(ctx.store.getState().archive).toHaveLength(2);

    act(() => {
      window.location.hash = '#/archive';
      window.dispatchEvent(new Event('hashchange'));
    });
    const list = screen.getByRole('list', { name: 'Keepsakes' });
    const entries = within(list).getAllByRole('listitem');
    expect(entries).toHaveLength(2);
    const text = document.querySelector('.archive')!.textContent!;
    expect(text).not.toContain('Secret plan');
    expect(text).not.toContain('Second secret');
    expect(document.title).not.toContain('secret');
    expect(window.location.hash).toBe('#/archive');
    // 每格是一枚章加那句绘本文案；不再是大只金幽灵加状态行
    expect(entries[0]!.querySelector('.archive-seal svg')).not.toBeNull();
    expect(entries[0]!.textContent).toMatch(/A little ghost, complete on \d{4}-\d{2}-\d{2}/);
    expect(entries[0]!.textContent).not.toContain('Steps done');

    fireEvent.click(within(entries[0]!).getByRole('button', { name: 'Show the title' }));
    expect(entries[0]!.textContent).toContain('Second secret');
    expect(entries[1]!.textContent).not.toContain('Secret plan');
    fireEvent.click(within(entries[0]!).getByRole('button', { name: 'Hide the title' }));
    expect(document.querySelector('.archive')!.textContent).not.toContain('Second secret');
    const visible = [
      document.body.textContent ?? '',
      ...[...document.querySelectorAll('[aria-label],[alt],[title]')].map((el) => `${el.getAttribute('aria-label')} ${el.getAttribute('alt')} ${el.getAttribute('title')}`),
    ].join('\n');
    expect(visible).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-|ub:|floor-0\d|ghostNo/);
  });

  it('纪念册为空：温柔的引导，不含催促', () => {
    window.location.hash = '#/archive';
    render(<App />);
    expect(document.querySelector('.archive')!.textContent).toMatch(/keepsake book is waiting/i);
    expect(document.querySelector('.archive')!.textContent).not.toMatch(/hurry|overdue|\blate\b|must/i);
  });
});

describe('详情卡与步骤里的 HTML 作为纯文本（属性 19 的交互补充）', () => {
  it('特殊字符只作为文字出现，不产生额外元素或事件属性', () => {
    fc.assert(
      fc.property(fc.constantFrom('<img src=x onerror=alert(1)>', '<script>alert(1)</script>', 'a & b "q" <b>x</b>', "'><svg onload=1>"), (text) => {
        cleanup();
        render(<App />);
        openCard('t');
        const imgs = document.querySelectorAll('img').length;
        type(/what does/i, text, card());
        click(/^save$/i, card());
        type(/add a small step/i, text, card());
        click(/add step/i, card());
        expect(card().querySelector('.criteria-text')!.textContent).toBe(text);
        expect(within(card()).getByRole('checkbox', { name: text })).toBeTruthy();
        expect(document.querySelectorAll('img').length).toBe(imgs);
        expect(document.querySelector('script')).toBeNull();
        expect(document.querySelectorAll('[onerror],[onload]')).toHaveLength(0);
      }),
      { numRuns: 12 },
    );
  });
});

describe('完成条件：保存后收成只读，Edit 才回到输入框', () => {
  const field = () => within(card()).queryByLabelText(/what does/i);
  const editBtn = () => within(card()).queryByRole('button', { name: 'Edit' });

  it('首次填写没有 Cancel；保存后折叠；Edit→Save；Edit→Cancel 不改内容；清空回到首次填写', () => {
    render(<App />);
    openCard();
    expect(field()).toBeTruthy();
    expect(within(card()).queryByRole('button', { name: 'Cancel' })).toBeNull();

    type(/what does/i, 'First words', card());
    click(/^save$/i, card());
    expect(field()).toBeNull();
    expect(card().querySelector('.count')).toBeNull();
    expect(within(card()).queryByRole('button', { name: /^save$/i })).toBeNull();
    expect(card().querySelector('.criteria-text')!.textContent).toBe('First words');
    expect(document.activeElement).toBe(editBtn());

    click('Edit', card());
    expect((field() as HTMLTextAreaElement).value).toBe('First words');
    expect(document.activeElement).toBe(field());
    type(/what does/i, 'Second words', card());
    click(/^save$/i, card());
    expect(field()).toBeNull();
    expect(card().querySelector('.criteria-text')!.textContent).toBe('Second words');

    click('Edit', card());
    type(/what does/i, 'Thrown away', card());
    click('Cancel', card());
    expect(field()).toBeNull();
    expect(card().querySelector('.criteria-text')!.textContent).toBe('Second words');
    expect(document.activeElement).toBe(editBtn());

    click('Edit', card());
    type(/what does/i, 'x'.repeat(201), card());
    click(/^save$/i, card());
    expect(within(card()).getByRole('alert')).toBeTruthy();
    expect((field() as HTMLTextAreaElement).value.length).toBe(201);
    click('Cancel', card());
    expect(within(card()).queryByRole('alert')).toBeNull();
    expect(card().querySelector('.criteria-text')!.textContent).toBe('Second words');

    click('Edit', card());
    type(/what does/i, '', card());
    click(/^save$/i, card());
    expect(field()).toBeTruthy();
    expect(editBtn()).toBeNull();
    expect(within(card()).queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(ghost().dataset.state).toBe('gray');
  });
});

// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import fc from 'fast-check';
import { App } from '../../src/components/App';
import { emptyState, type Env } from '../../src/domain/types';
import { createPersistentStore } from '../../src/store/bootstrap';
import { createUiStore } from '../../src/store/uiStore';
import { PRIMARY_KEY } from '../../src/persistence/keys';
import { serializeSave } from '../../src/persistence/serialize';
import { en } from '../../src/i18n/en';
import { zhCN } from '../../src/i18n/zh-CN';
import { copyIssues } from '../helpers/copyScan';
import { createFakeClock } from '../helpers/clock';
import { faultyKv, type FaultyKv } from '../helpers/faultyKv';

const env: Env = { now: () => '2026-11-09T08:00:00.000Z', today: () => '2026-11-09', newId: () => '12345678-1234-1234-1234-123456789abc' };
function boot(kv: FaultyKv, unavailable = false) {
  const clock = createFakeClock();
  const storage = { get length() { return kv.keys().length; }, key: (i: number) => kv.keys()[i] ?? null,
    getItem: (k: string) => kv.getItem(k), setItem: (k: string, v: string) => kv.setItem(k, v) };
  const store = createPersistentStore({ storage: unavailable ? null : storage, env, clock });
  return { store, clock, ctx: { store, ui: createUiStore(), roam: { positionOf: () => null } } };
}
const choose = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
afterEach(() => { cleanup(); window.location.hash = ''; });

describe('双语界面和会话边界', () => {
  it('首次英文；切换同步页面语言和标题、保留草稿，正常设置可重新加载', () => {
    const kv = faultyKv();
    const { ctx, clock } = boot(kv);
    const view = render(<App context={ctx} />);
    expect(document.documentElement.lang).toBe('en');
    fireEvent.input(screen.getByLabelText(en['create.label']), { target: { value: 'Keep my words' } });
    choose('简体中文');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(document.title).toBe(zhCN['app.title']);
    expect((screen.getByLabelText(zhCN['create.label']) as HTMLInputElement).value).toBe('Keep my words');
    act(() => clock.advance(1000));
    expect(JSON.parse(kv.peek(PRIMARY_KEY)!).settings.lang).toBe('zh-CN');
    view.unmount();
    render(<App context={boot(kv).ctx} />);
    expect(document.documentElement.lang).toBe('zh-CN');
    choose('English');
    expect(document.title).toBe(en['app.title']);
  });

  it('已有错误、状态、读屏名称与播报随语言变更；玩家正文原样保留', () => {
    const { ctx } = boot(faultyKv());
    render(<App context={ctx} />);
    choose(en['create.submit']);
    choose('简体中文');
    expect(screen.getByRole('alert').textContent).toBe(zhCN['create.error.empty'].replace('{max}', '80'));
    fireEvent.input(screen.getByLabelText(zhCN['create.label']), { target: { value: 'Gentle words' } });
    choose(zhCN['create.submit']);
    const ghost = document.querySelector<HTMLElement>('[data-ghost]')!;
    expect(ghost.getAttribute('aria-label')).toContain('住在2楼左边的小幽灵');
    fireEvent.click(ghost);
    const card = screen.getByRole('complementary');
    fireEvent.click(within(card).getByRole('button', { name: zhCN['steps.add.submit'] }));
    expect(within(card).getByRole('alert').textContent).toContain('给这一步写几个字');
    choose('English');
    expect(within(card).getByRole('alert').textContent).toContain('A step needs a few words');
    expect(ghost.getAttribute('aria-label')).toContain('The little ghost on floor 2, left');
    expect(ghost.getAttribute('aria-label')).toContain('Gentle words');
    expect(screen.getByRole('status').textContent).toBe(en['create.movedIn']);
  });

  it.each([false, true])('恢复与内存界面切换零写入（存储不可用：%s）', (unavailable) => {
    const raw = '{smudged notebook';
    const kv = faultyKv({ [PRIMARY_KEY]: raw, 'ub:backup:1': 'older notebook' });
    const { ctx, clock, store } = boot(kv, unavailable);
    const view = render(<App context={ctx} />);
    choose('简体中文');
    expect(document.documentElement.lang).toBe('zh-CN');
    if (!unavailable) {
      expect(screen.getByRole('heading', { name: zhCN['recovery.title'] })).toBeTruthy();
      choose(zhCN['recovery.blank.button']);
    }
    choose('English');
    choose('简体中文');
    act(() => { clock.advance(5000); store.flush(); window.dispatchEvent(new Event('pagehide')); });
    expect(kv.attempts).toEqual([]);
    expect(kv.peek(PRIMARY_KEY)).toBe(raw);
    view.unmount();
    render(<App context={boot(kv, unavailable).ctx} />);
    expect(document.documentElement.lang).toBe('en');
  });

  it.each(['en', 'zh-CN'] as const)('%s 实际渲染文字与可访问属性不泄露内部标识', (lang) => {
    const state = emptyState();
    state.settings.lang = lang;
    state.tasks = [{ id: env.newId(), ghostNo: 87654, title: 'A gentle errand', criteria: 'A clear little desk',
      steps: [{ id: 'step-secret', title: 'One small step', done: true }], slot: { floor: 2, slot: 0 }, createdAt: env.now() }];
    state.nextGhostNo = 87655;
    state.archive = [{ id: '87654321-1234-1234-1234-123456789abc', title: 'hidden keepsake title', titleVisible: false,
      completedOn: env.today(), confirmedAt: env.now(), stepCount: 1, memo: 'A lovely day' }];
    state.house.completedCount = 1;
    const kv = faultyKv({ [PRIMARY_KEY]: serializeSave(state) });
    const { container } = render(<App context={boot(kv).ctx} />);
    const inspect = () => {
      const attributes = [...container.querySelectorAll('*')].flatMap((el) =>
        ['aria-label', 'aria-description', 'alt', 'title', 'placeholder'].map((name) => el.getAttribute(name) ?? ''));
      const text = [container.textContent, document.title, ...attributes].join('\n');
      expect(copyIssues(text)).toEqual([]);
      expect(text).not.toContain('87654');
      expect(text).not.toContain('hidden keepsake title');
    };
    inspect();
    fireEvent.click(container.querySelector<HTMLElement>('[data-ghost]')!);
    inspect();
    choose(lang === 'en' ? en['confirm.button'] : zhCN['confirm.button']);
    inspect();
    choose(lang === 'en' ? en['confirm.no'] : zhCN['confirm.no']);
    choose(lang === 'en' ? en['card.close'] : zhCN['card.close']);
    act(() => { window.location.hash = '#/archive'; window.dispatchEvent(new Event('hashchange')); });
    inspect();
  });
});

describe('恢复与内存语言切换零写入（属性 12 的语言切换补充）', () => {
  it('任意往返语言序列都不尝试写任何键；刷新回到未写入的默认设置', () => {
    fc.assert(fc.property(fc.array(fc.constantFrom('en' as const, 'zh-CN' as const), { minLength: 1, maxLength: 40 }), (langs) => {
      const raw = '{smudged notebook';
      const kv = faultyKv({ [PRIMARY_KEY]: raw });
      const { store, clock } = boot(kv);
      for (const mode of ['recovery', 'memory'] as const) {
        if (mode === 'memory') store.continueInMemory();
        for (const lang of langs) { store.dispatch({ type: 'SetLang', lang }); store.flush(); clock.advance(1000); }
        expect(store.getState().settings.lang).toBe(langs.at(-1));
        expect(kv.attempts).toEqual([]);
        expect(kv.peek(PRIMARY_KEY)).toBe(raw);
      }
      expect(boot(kv).store.getState().settings.lang).toBe('en');
    }), { numRuns: 100 });
  });
});

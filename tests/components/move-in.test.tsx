// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import fc from 'fast-check';
import { App } from '../../src/components/App';

afterEach(cleanup);

function create(text: string) {
  fireEvent.input(screen.getByLabelText(/what's waiting/i), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: /welcome a little ghost/i }));
}

describe('创建表单与入住', () => {
  it('合法标题：二楼左侧出现一只灰色 Ghost，可访问名称含状态与位置、不含内部编号', () => {
    render(<App />);
    create('Call the landlord');
    const btn = screen.getByRole('button', { name: /call the landlord/i });
    expect(btn.getAttribute('data-state')).toBe('gray');
    expect(btn.getAttribute('data-floor')).toBe('2');
    expect(btn.getAttribute('data-slot')).toBe('0');
    const name = btn.getAttribute('aria-label')!;
    expect(name).toContain('floor 2, left');
    expect(name).toContain('Not clear yet');
    expect(name).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect((screen.getByLabelText(/what's waiting/i) as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('status').textContent).toBe('A little ghost moved in.');
  });

  it('空白与 81 字符被拒，显示上限并保留草稿', () => {
    render(<App />);
    create('   ');
    expect(screen.getByRole('alert').textContent).toContain('80');
    expect(screen.queryAllByRole('button', { name: /little ghost on floor/i })).toHaveLength(0);
    const long = 'x'.repeat(81);
    create(long);
    expect(screen.getByRole('alert').textContent).toContain('81');
    expect((screen.getByLabelText(/what's waiting/i) as HTMLInputElement).value).toBe(long);
    expect(document.querySelectorAll('[data-ghost]')).toHaveLength(0);
  });

  it('标题里的 HTML 作为纯文本，不多出元素（属性 19 的创建流程补充）', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('<img src=x onerror=alert(1)>', '<script>alert(1)</script>', 'a & b "q" <b>x</b>', "'><svg onload=1>"),
        (title) => {
          cleanup();
          render(<App />);
          const before = document.querySelectorAll('img').length;
          create(title);
          const btn = document.querySelector('[data-ghost]')!;
          expect(btn.getAttribute('aria-label')).toContain(title);
          expect(document.querySelectorAll('img').length).toBe(before);
          expect(document.querySelector('script')).toBeNull();
          expect(document.querySelectorAll('[onerror],[onload]')).toHaveLength(0);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('点击 Ghost 才选中；点击旧宅空白处不改变选中', () => {
    render(<App />);
    create('One');
    const btn = screen.getByRole('button', { name: /one/i });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(document.querySelector('.house')!);
    fireEvent.click(document.querySelector('.house-overlay')!);
    fireEvent.click(document.querySelector('.static-layer')!);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(document.querySelector('.house')!);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('第 2 只在二楼右侧；第 3 只在三楼左侧；列表顺序为楼层从高到低', () => {
    render(<App />);
    create('a');
    create('b');
    create('c');
    const info = [...document.querySelectorAll<HTMLElement>('[data-ghost]')].map((b) => `${b.dataset.floor}:${b.dataset.slot}`);
    expect(info).toEqual(['3:0', '2:0', '2:1']);
  });

  it('满员后第 11 次被拒，显示原文提示并保留草稿', () => {
    render(<App />);
    for (let i = 0; i < 10; i++) create(`t${i}`);
    create('eleventh');
    expect(document.querySelector('dialog')!.textContent).toMatch(/The house is full/);
    expect((screen.getByLabelText(/what's waiting/i) as HTMLInputElement).value).toBe('eleventh');
    expect(document.querySelectorAll('[data-ghost]')).toHaveLength(10);
  });
});

// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { App } from '../../src/components/App';

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

const ghost = () => document.querySelector<HTMLElement>('[data-ghost]')!;

describe('Ghost 脚下进度牌', () => {
  it('aria-label 始终含 X of Y done（默认与选中），标签对读屏隐藏，不含内部编号', () => {
    render(<App />);
    fireEvent.input(screen.getByLabelText(/still waiting/i), { target: { value: 'Tidy the desk' } });
    fireEvent.click(screen.getByRole('button', { name: /welcome a little ghost/i }));
    expect(ghost().getAttribute('aria-label')).toMatch(/0 of 0 done$/);
    fireEvent.click(ghost());
    const card = screen.getByRole('complementary', { name: /details/i });
    fireEvent.input(within(card).getByLabelText(/add a small step/i), { target: { value: 'one' } });
    fireEvent.click(within(card).getByRole('button', { name: /add step/i }));
    expect(ghost().getAttribute('aria-pressed')).toBe('true');
    expect(ghost().getAttribute('aria-label')).toMatch(/0 of 1 done$/);
    expect(ghost().querySelector('.ghost-tag')!.getAttribute('aria-hidden')).toBe('true');
    expect(ghost().getAttribute('aria-label')).not.toMatch(/ghost-|[0-9a-f]{8}-/);
  });

  it('样式：默认 opacity 0，仅 hover / focus-visible 显示，不拦截指针，Reduced Motion 无过渡', () => {
    const css = readFileSync(resolve(__dirname, '../../src/styles.css'), 'utf8');
    const base = css.match(/\.ghost-tag \{[^}]*\}/)![0];
    expect(base).toMatch(/opacity: 0;/);
    expect(base).toMatch(/pointer-events: none;/);
    expect(base).toMatch(/position: absolute;/);
    expect(css).toMatch(/\.ghost-button:focus-visible \.ghost-tag \{\s*opacity: 1;/);
    expect(css).toMatch(/@media \(hover: hover\) \{\s*\.ghost-button:hover \.ghost-tag \{\s*opacity: 1;/);
    expect(css).not.toMatch(/aria-pressed='true'\][^{]*\.ghost-tag/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.ghost-tag \{\s*transition: none;/);
  });
});

// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/preact';
import { App } from '../src/components/App';

afterEach(cleanup);

describe('冒烟', () => {
  it('占位首屏只有一个 h1', () => {
    render(<App />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});

// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/preact';
import { App } from '../../src/components/App';
import { createStore } from '../../src/store/store';
import { createUiStore } from '../../src/store/uiStore';
import { emptyState } from '../../src/domain/types';
import { t } from '../../src/i18n/t';

vi.mock('../../src/i18n/copy', async (original) => ({ ...await original<object>(), SUPPORT_ZH: false }));
afterEach(cleanup);

it('裁掉中文开关后，即使旧设置为中文，仍为完整英文，html.lang 一致', () => {
  const initial = emptyState();
  initial.settings.lang = 'zh-CN';
  const store = createStore({ initial, env: { now: () => '2026-11-09T08:00:00.000Z', today: () => '2026-11-09', newId: () => 'fixture' } });
  render(<App context={{ store, ui: createUiStore(), roam: { positionOf: () => null } }} />);
  expect(screen.queryByRole('group', { name: 'Language' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Welcome a little ghost' })).toBeTruthy();
  expect(document.documentElement.lang).toBe('en');
  expect(document.title).toBe('Unfinished Business');
  expect(t('state.gray', undefined, 'zh-CN')).toBe('Not clear yet');
});

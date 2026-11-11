import { describe, expect, it } from 'vitest';
import { COPY_KEYS } from '../src/i18n/copy';
import { en } from '../src/i18n/en';
import { zhCN } from '../src/i18n/zh-CN';
import { forLanguage, t } from '../src/i18n/t';

describe('Copy_Resource（完整双语）', () => {
  it.each([['en', en], ['zh-CN', zhCN]])('%s 覆盖全部键且无多余键、无空文案', (_lang, table) => {
    expect(Object.keys(table).sort()).toEqual([...COPY_KEYS].sort());
    for (const k of COPY_KEYS) expect(table[k].trim().length).toBeGreaterThan(0);
  });

  it('双语占位符逐键一致，中文内容不意外回落英文', () => {
    const tokens = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of COPY_KEYS) {
      expect(tokens(zhCN[key]), key).toEqual(tokens(en[key]));
      if (!key.startsWith('language.') && key !== 'criteria.count') expect(zhCN[key], key).not.toBe(en[key]);
    }
    expect(forLanguage('zh-CN')('ghost.location', { floor: 2, side: zhCN['ghost.side.left'] })).toBe('住在2楼左边的小幽灵');
    expect(t('ghost.progress', { done: 1, total: 3 }, 'zh-CN')).toBe('已完成 1/3');
    // 两个翻译函数互不串语言。
    expect(forLanguage('en')('state.gray')).toBe('Not clear yet');
    expect(forLanguage('zh-CN')('state.gray')).toBe('还没想清楚');
  });

  it('t() 替换占位符，未知占位符原样保留', () => {
    expect(t('create.error.tooLong', { length: 81, max: 80 })).toContain('81');
    expect(t('create.error.tooLong', { length: 81, max: 80 })).toContain('80');
    expect(t('ghost.location', { floor: 2 })).toContain('floor 2');
    expect(t('ghost.location', { floor: 2 })).toContain('{side}');
    expect(t('state.gray')).toBe('Not clear yet');
  });

  it('满员文案与需求 1.5 原文一致', () => {
    expect(t('create.error.houseFull')).toBe(
      'The house is full. A little ghost is waiting at the door with their luggage. Walk one resident through their journey into the Archive, then welcome them in.',
    );
  });
});

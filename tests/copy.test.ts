import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COPY_KEYS, type Lang } from '../src/i18n/copy';
import { en } from '../src/i18n/en';
import { zhCN } from '../src/i18n/zh-CN';
import { COPY_ALLOWLIST, copyIssues, EMOTION, INTERNAL, TECH } from './helpers/copyScan';

const tables = { en, 'zh-CN': zhCN };

describe('Copy_Resource 玩家可见文案（全部键、两种语言）', () => {
  it.each(Object.entries(tables))('%s 不含情绪禁词、技术细节或内部标识', (lang, table) => {
    for (const key of COPY_KEYS) expect(copyIssues(table[key], lang as Lang, key), `${lang}:${key}`).toEqual([]);
  });

  it('白名单逐条有理由、精确限定键与命中词，且没有失效或重复条目', () => {
    const seen = new Set<string>();
    for (const item of COPY_ALLOWLIST) {
      expect(item.reason.trim().length).toBeGreaterThan(0);
      expect(tables[item.lang][item.key]).toContain(item.token);
      expect([EMOTION, TECH, INTERNAL].some((p) => p.test(item.token))).toBe(true);
      const identity = `${item.lang}:${item.key}:${item.token}`;
      expect(seen.has(identity)).toBe(false);
      seen.add(identity);
    }
  });

  it('满员文案与 R1.5 原文逐字符一致（含两个按钮）', () => {
    const requirements = readFileSync(new URL('../.kiro/specs/unfinished-business/requirements.md', import.meta.url), 'utf8');
    const line = requirements.split('\n').find((l) => l.includes('WHEN 满员提示出现'))!;
    expect(en['create.error.houseFull']).toBe(line.match(/显示文案“([^”]+)”/)![1]);
    expect(zhCN['create.error.houseFull']).toBe(line.match(/中文：“([^”]+)”/)![1]);
    expect([en['fullHouse.visit'], zhCN['fullHouse.visit']].join('／')).toBe('Visit residents／去看看住客');
    expect([en['fullHouse.later'], zhCN['fullHouse.later']].join('／')).toBe('Come back later／稍后再来');
  });

  it.each(Object.values(tables))('删除文案只有搬走与告别，没有放弃或失败', (table) => {
    for (const key of COPY_KEYS.filter((k) => k.startsWith('moveOut.') || k === 'live.movedOut')) {
      expect(copyIssues(table[key]), key).toEqual([]);
    }
  });

  it('扫描器自检：中英文禁词、文件名、生成工具与完整内部标识均能拦截', () => {
    for (const text of ['断签', '逾期', '羞辱', '催促', '愧疚', '放弃', '失败',
      'streak', 'overdue', 'late', 'failed', 'give up', 'hurry', 'shame', 'guilty',
      '哈希', '版本', '键名', '存储格式', '解析', '素材来源', '生成工具', '碰撞框',
      'hash', 'schema', 'localStorage', 'JSON', 'ChatGPT', 'DALL-E', 'house.png',
      'ub:save', 'floor-01', 'ghostNo', '12345678-1234-1234-1234-123456789abc']) {
      expect(copyIssues(text).length, text).toBeGreaterThan(0);
    }
    expect(copyIssues('A little ghost, complete on 2026-11-09.')).toEqual([]);
    expect(copyIssues('一只小幽灵，在 2026-11-09 圆满')).toEqual([]);
  });

  it('关键反馈保持绘本口吻', () => {
    expect(en['live.erase']).toContain('Oops, let me fix that');
    expect(zhCN['live.erase']).toContain('手滑啦，改一下');
    expect(en['confirm.failed']).toContain("stamp didn't land");
    expect(zhCN['confirm.failed']).toContain('小章没能盖下来');
    expect(zhCN['stamp.complete']).toBe('已圆满');
  });
});

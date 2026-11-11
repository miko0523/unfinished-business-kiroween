import type { Page } from '@playwright/test';
import type { MemorialEntry } from '../../src/domain/types';
import { serializeSave } from '../../src/persistence/serialize';

/** 一份合法的存档文本：只含 n 条纪念，没有住客（仅测试里用，直接写入 ub:save）。 */
export function saveWithArchive(n: number, titles: (i: number) => string = (i) => `Secret task ${i}`): string {
  const archive: MemorialEntry[] = Array.from({ length: n }, (_, i) => ({
    id: `entry-${i}`,
    title: titles(i),
    titleVisible: false,
    completedOn: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
    stepCount: 2,
    memo: i === n - 1 && n > 0 ? 'The last <b>one</b> & dear' : '',
    confirmedAt: new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString(),
  }));
  return serializeSave({ tasks: [], archive, house: { grownFloors: 2, completedCount: n }, settings: { lang: 'en' }, nextGhostNo: 1 });
}

/** 在页面加载前写入存档（addInitScript 每次导航都会重跑，所以只在没有存档时写）。 */
export async function seedSave(page: Page, raw: string) {
  await page.addInitScript((text) => {
    if (localStorage.getItem('ub:save') === null) localStorage.setItem('ub:save', text);
  }, raw);
}

/** Natural, synthetic memorial notes for presentation screenshots (the escaping fixtures above stay as safety tests). */
export const NATURAL_NOTES = {
  en: [
    'Booked the dentist at last. Tea was earned.',
    'Sent the thank-you card that had been waiting on the desk.',
    'Watered every plant, even the sulky fern.',
    'Cleared one drawer. Found a lost button.',
    'Finally replied to the long email.',
    'Took the library books back, a little late and very proud.',
  ],
  'zh-CN': [
    '终于把牙医约好啦，给自己泡杯茶。',
    '桌上等了好久的感谢卡，今天寄出去了。',
    '每一盆花都浇到了，连最闹别扭的那盆蕨。',
    '收拾了一个抽屉，还找到一颗走丢的纽扣。',
    '那封很长的邮件，总算回完了。',
    '图书馆的书还回去了，晚了一点，但很骄傲。',
  ],
} as const;

export const NATURAL_TITLES = {
  en: ['Dentist', 'Thank-you card', 'Plants', 'Drawer', 'Long email', 'Library books'],
  'zh-CN': ['约牙医', '感谢卡', '浇花', '整理抽屉', '回邮件', '还图书'],
} as const;

export function saveWithNaturalArchive(n: number, lang: 'en' | 'zh-CN' = 'en'): string {
  const archive: MemorialEntry[] = Array.from({ length: n }, (_, i) => ({
    id: `natural-${i}`,
    title: NATURAL_TITLES[lang][i % 6]!,
    titleVisible: false,
    completedOn: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
    stepCount: 2,
    memo: i % 2 === 0 || i === n - 1 ? NATURAL_NOTES[lang][i % 6]! : '',
    confirmedAt: new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString(),
  }));
  return serializeSave({ tasks: [], archive, house: { grownFloors: 2, completedCount: n }, settings: { lang }, nextGhostNo: 1 });
}

/** An archive whose entries carry exactly the given memos (verbatim, including blank ones), titles all private. */
export function saveWithMemos(memos: readonly string[], lang: 'en' | 'zh-CN' = 'en', titleOf: (i: number) => string = (i) => `Private title ${i}`): string {
  const archive: MemorialEntry[] = memos.map((memo, i) => ({
    id: `memo-${i}`,
    title: titleOf(i),
    titleVisible: false,
    completedOn: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
    stepCount: 2,
    memo,
    confirmedAt: new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString(),
  }));
  return serializeSave({ tasks: [], archive, house: { grownFloors: 2, completedCount: memos.length }, settings: { lang }, nextGhostNo: 1 });
}

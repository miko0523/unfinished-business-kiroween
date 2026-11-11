// 四种读不了的存档文本（纯数据，单元测试与浏览器脚本共用）。
const task = (n: number, floor: number, slot: number, title = `Task ${n}`) => ({
  id: `t${n}`,
  ghostNo: n,
  title,
  criteria: '',
  steps: [],
  slot: { floor, slot },
  createdAt: '2026-11-08T08:00:00.000Z',
});

const base = (tasks: unknown[], version = 1) => ({
  schema_version: version,
  tasks,
  archive: [],
  house: { grownFloors: 2, completedCount: 0 },
  settings: { lang: 'en' },
  nextGhostNo: 10,
});

/** 带非 ASCII 与表情的非法 JSON，用来检验逐字符一致。 */
export const INVALID_JSON = '{"tasks": [整理书桌 🌙 "smudged\n\t",, ';

export const BAD_SAVES: Readonly<Record<string, string>> = {
  'invalid-json': INVALID_JSON,
  'unsupported-version': JSON.stringify(base([task(1, 2, 0)], 2)),
  'overlong-title': JSON.stringify(base([task(1, 2, 0, 'x'.repeat(81))])),
  'duplicate-slot': JSON.stringify(base([task(1, 2, 0), task(2, 2, 0)])),
};

/** 合法的最小存档（用来确认测试用的“坏”确实只坏在该坏的地方）。 */
export const GOOD_SAVE = JSON.stringify(base([task(1, 2, 0)]));

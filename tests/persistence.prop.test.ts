import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { floorsNeeded } from '../src/domain/slots';
import { emptyState, type AppState, type FloorNo, type MemorialEntry, type SideNo, type Task } from '../src/domain/types';
import { parseSave } from '../src/persistence/parse';
import { serializeSave } from '../src/persistence/serialize';

// ---- 生成器：合法存档 ----
const text = (min: number, max: number) =>
  fc.string({ unit: 'binary', minLength: min, maxLength: max }).filter((s) => [...s].length >= min && [...s].length <= max);
const title = (max: number) => text(1, max).filter((s) => s.trim().length > 0);
const iso = fc.date({ min: new Date('2000-01-01'), max: new Date('2100-01-01'), noInvalidDate: true }).map((d) => d.toISOString());
const day = fc.date({ min: new Date('2000-01-01'), max: new Date('2100-01-01'), noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10));
const ident = fc.string({ unit: 'grapheme-ascii', minLength: 1, maxLength: 12 });

const step = fc.record({ id: ident, title: title(80), done: fc.boolean() });
const steps = fc.uniqueArray(step, { selector: (s) => s.id, maxLength: 8 });

const entry: fc.Arbitrary<MemorialEntry> = fc.record({
  id: ident,
  title: title(80),
  titleVisible: fc.boolean(),
  completedOn: day,
  stepCount: fc.integer({ min: 0, max: 50 }),
  memo: text(0, 140),
  confirmedAt: iso,
});

const allSlots = [2, 3, 4, 5, 6].flatMap((floor) => [0, 1].map((slot) => ({ floor: floor as FloorNo, slot: slot as SideNo })));

export const validSave: fc.Arbitrary<AppState> = fc
  .record({
    slots: fc.shuffledSubarray(allSlots, { minLength: 0, maxLength: 10 }),
    archive: fc.uniqueArray(entry, { selector: (e) => e.id, maxLength: 5 }),
    extraFloors: fc.integer({ min: 0, max: 4 }),
    lang: fc.constantFrom('en' as const, 'zh-CN' as const),
    gap: fc.integer({ min: 0, max: 5 }),
  })
  .chain(({ slots, archive, extraFloors, lang, gap }) =>
    fc
      .tuple(
        fc.uniqueArray(ident, { minLength: slots.length, maxLength: slots.length }),
        fc.array(fc.record({ title: title(80), criteria: text(0, 200), steps, createdAt: iso }), { minLength: slots.length, maxLength: slots.length }),
      )
      .map(([ids, bodies]) => {
        const tasks: Task[] = slots.map((slot, i) => ({ id: ids[i]!, ghostNo: i + 1, slot, ...bodies[i]! }));
        const need = Math.max(floorsNeeded(tasks.length), ...tasks.map((t) => t.slot.floor), 2);
        const grown = Math.min(6, need + extraFloors) as FloorNo;
        return {
          tasks,
          archive,
          house: { grownFloors: grown, completedCount: archive.length },
          settings: { lang },
          nextGhostNo: tasks.length + 1 + gap,
        } satisfies AppState;
      }),
  );

describe('Feature: unfinished-business, Property 10: 序列化往返', () => {
  it('parseSave(serializeSave(d)) 成功且深度相等', () => {
    fc.assert(
      fc.property(validSave, (d) => {
        const r = parseSave(serializeSave(d));
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.value).toEqual(d);
      }),
      { numRuns: 200 },
    );
  });

  it('空存档往返', () => {
    const r = parseSave(serializeSave(emptyState()));
    expect(r).toEqual({ ok: true, value: emptyState() });
  });

  it('未知额外字段被忽略，且不会出现在结果里', () => {
    const raw = JSON.parse(serializeSave(emptyState()));
    raw.extra = { a: 1 };
    raw.house.mood = 'x';
    const r = parseSave(JSON.stringify(raw));
    expect(r).toEqual({ ok: true, value: emptyState() });
  });
});

describe('Feature: unfinished-business, Property 11: Parser 不抛异常', () => {
  const garbage = fc.oneof(
    fc.string({ unit: 'binary' }),
    fc.json(),
    fc.jsonValue().map((v) => JSON.stringify(v)),
    validSave.chain((d) => fc.integer({ min: 0, max: serializeSave(d).length }).map((n) => serializeSave(d).slice(0, n))),
  );

  it('任意字符串都返回 Result 而不抛出', () => {
    fc.assert(
      fc.property(garbage, (raw) => {
        const r = parseSave(raw);
        expect(typeof r.ok).toBe('boolean');
      }),
      { numRuns: 300 },
    );
  });

  it('把合法存档里的任意位置改成任意 JSON 值，也只会返回 Result', () => {
    const paths = fc.array(fc.constantFrom('tasks', 'archive', 'house', 'settings', 'nextGhostNo', '0', 'slot', 'steps', 'title', 'floor', 'lang', 'id'), { maxLength: 4 });
    fc.assert(
      fc.property(validSave, paths, fc.jsonValue(), (d, path, value) => {
        const doc = JSON.parse(serializeSave(d));
        let node = doc;
        for (const key of path.slice(0, -1)) {
          if (node && typeof node === 'object' && key in node) node = node[key];
        }
        const last = path[path.length - 1];
        if (last !== undefined && node && typeof node === 'object') node[last] = value;
        const r = parseSave(JSON.stringify(doc));
        expect(typeof r.ok).toBe('boolean');
      }),
      { numRuns: 300 },
    );
  });

  it('非字符串入参也不抛', () => {
    for (const bad of [undefined, null, 1, {}, []] as unknown[]) expect(parseSave(bad as string).ok).toBe(false);
  });

  it('深层嵌套不会抛', () => {
    expect(parseSave('['.repeat(200_000)).ok).toBe(false);
  });
});

describe('非法存档都被拒绝', () => {
  const base = (): Record<string, any> => {
    const s: AppState = {
      tasks: [
        { id: 'a', ghostNo: 1, title: 'A', criteria: '', steps: [{ id: 's', title: 'x', done: false }], slot: { floor: 2, slot: 0 }, createdAt: '2026-11-07T00:00:00.000Z' },
        { id: 'b', ghostNo: 2, title: 'B', criteria: '', steps: [], slot: { floor: 2, slot: 1 }, createdAt: '2026-11-07T00:00:00.000Z' },
      ],
      archive: [{ id: 'e', title: 'T', titleVisible: false, completedOn: '2026-11-07', stepCount: 1, memo: '', confirmedAt: '2026-11-07T00:00:00.000Z' }],
      house: { grownFloors: 2, completedCount: 1 },
      settings: { lang: 'en' },
      nextGhostNo: 3,
    };
    return JSON.parse(serializeSave(s));
  };
  const rejects = (name: string, edit: (d: Record<string, any>) => void) =>
    it(name, () => {
      const d = base();
      edit(d);
      expect(parseSave(JSON.stringify(d)).ok).toBe(false);
    });

  it('基线是合法的', () => expect(parseSave(JSON.stringify(base())).ok).toBe(true));
  it('schema_version 不是 1 给出“不支持”', () => {
    const d = base();
    d.schema_version = 2;
    expect(parseSave(JSON.stringify(d))).toEqual({ ok: false, error: { kind: 'unsupported-version' } });
    delete d.schema_version;
    expect(parseSave(JSON.stringify(d)).ok).toBe(false);
  });
  it('非 JSON 与非对象', () => {
    expect(parseSave('{oops')).toEqual({ ok: false, error: { kind: 'not-json' } });
    expect(parseSave('[]')).toEqual({ ok: false, error: { kind: 'not-object' } });
    expect(parseSave('null').ok).toBe(false);
    expect(parseSave('').ok).toBe(false);
  });
  rejects('标题超长', (d) => (d.tasks[0].title = 'x'.repeat(81)));
  rejects('标题为空白', (d) => (d.tasks[0].title = '   '));
  rejects('完成条件超长', (d) => (d.tasks[0].criteria = 'x'.repeat(201)));
  rejects('步骤标题超长', (d) => (d.tasks[0].steps[0].title = 'x'.repeat(81)));
  rejects('步骤超过 50', (d) => (d.tasks[0].steps = Array.from({ length: 51 }, (_, i) => ({ id: `s${i}`, title: 'x', done: false }))));
  rejects('步骤 id 重复', (d) => d.tasks[0].steps.push({ id: 's', title: 'y', done: false }));
  rejects('留言超长', (d) => (d.archive[0].memo = 'x'.repeat(141)));
  rejects('Slot 重复', (d) => (d.tasks[1].slot = { floor: 2, slot: 0 }));
  rejects('楼层越界', (d) => (d.tasks[0].slot.floor = 7));
  rejects('楼层为 1', (d) => (d.tasks[0].slot.floor = 1));
  rejects('slot 不是 0/1', (d) => (d.tasks[0].slot.slot = 2));
  rejects('超过 10 个住客', (d) => {
    d.tasks = Array.from({ length: 11 }, (_, i) => ({ ...d.tasks[0], id: `t${i}`, ghostNo: i + 1, slot: { floor: 2 + Math.floor(i / 2), slot: i % 2 } }));
    d.house.grownFloors = 6;
    d.nextGhostNo = 50;
  });
  rejects('ghostNo 重复', (d) => (d.tasks[1].ghostNo = 1));
  rejects('ghostNo 不小于 nextGhostNo', (d) => (d.nextGhostNo = 2));
  rejects('task id 重复', (d) => (d.tasks[1].id = 'a'));
  rejects('grownFloors 小于所需', (d) => {
    d.tasks.push({ ...d.tasks[0], id: 'c', ghostNo: 3, slot: { floor: 3, slot: 0 } });
    d.nextGhostNo = 4;
  });
  rejects('grownFloors 低于 Task 所在楼层', (d) => {
    d.tasks[0].slot.floor = 4;
  });
  rejects('grownFloors 越界', (d) => (d.house.grownFloors = 7));
  rejects('completedCount 与 archive 不符', (d) => (d.house.completedCount = 2));
  rejects('completedCount 为负', (d) => (d.house.completedCount = -1));
  rejects('completedCount 为小数', (d) => (d.house.completedCount = 1.5));
  rejects('lang 不合法', (d) => (d.settings.lang = 'fr'));
  rejects('createdAt 不可解析', (d) => (d.tasks[0].createdAt = 'yesterday'));
  rejects('confirmedAt 不可解析', (d) => (d.archive[0].confirmedAt = 'x'));
  rejects('completedOn 不是真实日期', (d) => (d.archive[0].completedOn = '2026-02-31'));
  rejects('titleVisible 不是布尔', (d) => (d.archive[0].titleVisible = 'no'));
  rejects('done 不是布尔', (d) => (d.tasks[0].steps[0].done = 1));
  rejects('tasks 不是数组', (d) => (d.tasks = {}));
  rejects('缺 settings', (d) => delete d.settings);
  rejects('nextGhostNo 为 0', (d) => (d.nextGhostNo = 0));
});

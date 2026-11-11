// 严格解析存档文本：任何不合格的输入都返回 { ok: false }，永不抛出。
import { floorsNeeded, MAX_RESIDENTS } from '../domain/slots';
import type { FloorNo, GhostKind, MemorialEntry, SideNo, Step, Task } from '../domain/types';
import { codePointLength, CRITERIA_MAX, MEMO_MAX, STEP_TITLE_MAX, STEPS_MAX, TITLE_MAX } from '../domain/validate';
import { SCHEMA_VERSION } from './keys';
import type { ParseError, ParseResult } from './types';

class Invalid extends Error {
  constructor(readonly path: string) {
    super(path);
  }
}

type Obj = Record<string, unknown>;

const fail = (path: string): never => {
  throw new Invalid(path);
};

function obj(v: unknown, path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail(path);
  return v as Obj;
}

function arr(v: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(v) || v.length > max) return fail(path);
  return v;
}

function int(v: unknown, path: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) return fail(path);
  return v;
}

function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') return fail(path);
  return v;
}

function id(v: unknown, path: string): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 200) return fail(path);
  return v;
}

/** 非空白、码点数不超过 max 的标题。 */
function titleText(v: unknown, path: string, max: number): string {
  if (typeof v !== 'string' || v.trim().length === 0 || codePointLength(v) > max) return fail(path);
  return v;
}

function text(v: unknown, path: string, max: number): string {
  if (typeof v !== 'string' || codePointLength(v) > max) return fail(path);
  return v;
}

function timestamp(v: unknown, path: string): string {
  if (typeof v !== 'string' || v.length > 64 || Number.isNaN(Date.parse(v))) return fail(path);
  return v;
}

/** 真实存在的日历日期 YYYY-MM-DD。 */
function calendarDay(v: unknown, path: string): string {
  if (typeof v !== 'string') return fail(path);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return fail(path);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return fail(path);
  return v;
}

function step(v: unknown, path: string): Step {
  const o = obj(v, path);
  return { id: id(o.id, `${path}.id`), title: titleText(o.title, `${path}.title`, STEP_TITLE_MAX), done: bool(o.done, `${path}.done`) };
}

function task(v: unknown, path: string): Task {
  const o = obj(v, path);
  const slot = obj(o.slot, `${path}.slot`);
  const steps = arr(o.steps, `${path}.steps`, STEPS_MAX).map((s, i) => step(s, `${path}.steps[${i}]`));
  if (new Set(steps.map((s) => s.id)).size !== steps.length) fail(`${path}.steps`);
  return {
    ...identity(o, path),
    id: id(o.id, `${path}.id`),
    ghostNo: int(o.ghostNo, `${path}.ghostNo`, 1),
    title: titleText(o.title, `${path}.title`, TITLE_MAX),
    criteria: text(o.criteria, `${path}.criteria`, CRITERIA_MAX),
    steps,
    slot: { floor: int(slot.floor, `${path}.slot.floor`, 2, 6) as FloorNo, slot: int(slot.slot, `${path}.slot.slot`, 0, 1) as SideNo },
    createdAt: timestamp(o.createdAt, `${path}.createdAt`),
  };
}

function entry(v: unknown, path: string): MemorialEntry {
  const o = obj(v, path);
  return {
    ...identity(o, path),
    id: id(o.id, `${path}.id`),
    title: titleText(o.title, `${path}.title`, TITLE_MAX),
    titleVisible: bool(o.titleVisible, `${path}.titleVisible`),
    completedOn: calendarDay(o.completedOn, `${path}.completedOn`),
    stepCount: int(o.stepCount, `${path}.stepCount`, 0, STEPS_MAX),
    memo: text(o.memo, `${path}.memo`, MEMO_MAX),
    confirmedAt: timestamp(o.confirmedAt, `${path}.confirmedAt`),
  };
}

function unique<T>(items: readonly T[]): boolean {
  return new Set(items).size === items.length;
}

function identity(o: Obj, path: string): { ghostKind?: GhostKind } {
  if (!Object.hasOwn(o, 'ghostKind')) return {};
  if (o.ghostKind !== 'ordinary' && o.ghostKind !== 'lantern') fail(`${path}.ghostKind`);
  return { ghostKind: o.ghostKind as GhostKind };
}

function build(root: Obj): ParseResult & { ok: true } {
  const tasks = arr(root.tasks, 'tasks', MAX_RESIDENTS).map((t, i) => task(t, `tasks[${i}]`));
  if (!unique(tasks.map((t) => t.id))) fail('tasks');
  if (!unique(tasks.map((t) => t.ghostNo))) fail('tasks.ghostNo');
  if (!unique(tasks.map((t) => `${t.slot.floor}:${t.slot.slot}`))) fail('tasks.slot');

  const archive = arr(root.archive, 'archive', Number.MAX_SAFE_INTEGER).map((e, i) => entry(e, `archive[${i}]`));
  if (!unique(archive.map((e) => e.id))) fail('archive');

  const house = obj(root.house, 'house');
  const grownFloors = int(house.grownFloors, 'house.grownFloors', 2, 6) as FloorNo;
  const completedCount = int(house.completedCount, 'house.completedCount', 0);
  if (completedCount !== archive.length) fail('house.completedCount');
  if (grownFloors < floorsNeeded(tasks.length)) fail('house.grownFloors');
  if (tasks.some((t) => t.slot.floor > grownFloors)) fail('house.grownFloors');

  const settings = obj(root.settings, 'settings');
  if (settings.lang !== 'en' && settings.lang !== 'zh-CN') fail('settings.lang');
  const lang: 'en' | 'zh-CN' = settings.lang as 'en' | 'zh-CN';

  const nextGhostNo = int(root.nextGhostNo, 'nextGhostNo', 1);
  if (tasks.some((t) => t.ghostNo >= nextGhostNo)) fail('nextGhostNo');

  return {
    ok: true,
    value: {
      tasks, archive, house: { grownFloors, completedCount }, settings: { lang }, nextGhostNo,
      ...(Object.hasOwn(root, 'collection') ? { collection: { lanternWelcomed: bool(obj(root.collection, 'collection').lanternWelcomed, 'collection.lanternWelcomed') } } : {}),
    },
  };
}

/** raw 不是合法存档时返回错误；不抛出，也不修改任何东西。 */
export function parseSave(raw: string): ParseResult {
  try {
    if (typeof raw !== 'string') return { ok: false, error: { kind: 'not-json' } };
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return { ok: false, error: { kind: 'not-json' } };
    }
    if (typeof json !== 'object' || json === null || Array.isArray(json)) return { ok: false, error: { kind: 'not-object' } };
    const root = json as Obj;
    if (root.schema_version !== SCHEMA_VERSION) return { ok: false, error: { kind: 'unsupported-version' } };
    return build(root);
  } catch (e) {
    const error: ParseError = { kind: 'invalid', path: e instanceof Invalid ? e.path : '?' };
    return { ok: false, error };
  }
}

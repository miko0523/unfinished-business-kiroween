import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { emptyState } from '../src/domain/types';
import { PRIMARY_KEY } from '../src/persistence/keys';
import { parseSave } from '../src/persistence/parse';
import { backupAndStartFresh, nextBackupKey } from '../src/persistence/recovery';
import { serializeSave } from '../src/persistence/serialize';
import { BAD_SAVES, GOOD_SAVE } from './helpers/badSaves';
import { createPersistentStore } from '../src/store/bootstrap';
import type { Env } from '../src/domain/types';
import { createFakeClock } from './helpers/clock';
import { faultyKv } from './helpers/faultyKv';

const env: Env = { now: () => '2026-11-09T08:00:00.000Z', today: () => '2026-11-09', newId: () => 'id-1' };
const storageOf = (kv: ReturnType<typeof faultyKv>) => ({
  get length() { return kv.keys().length; },
  key: (i: number) => kv.keys()[i] ?? null,
  getItem: (k: string) => kv.getItem(k),
  setItem: (k: string, v: string) => kv.setItem(k, v),
});

const fresh = emptyState();
const freshText = serializeSave(fresh);
/** 含任意 Unicode、控制字符、换行，也含超长字符串。 */
const rawArb = fc.oneof({ weight: 5, arbitrary: fc.string({ unit: 'binary', maxLength: 200 }) }, { weight: 1, arbitrary: fc.string({ unit: 'binary', minLength: 5000, maxLength: 20000 }) });

describe('四种坏存档确实读不了（而好存档读得了）', () => {
  it('parseSave 拒绝它们', () => {
    expect(parseSave(GOOD_SAVE).ok).toBe(true);
    for (const [name, raw] of Object.entries(BAD_SAVES)) expect(parseSave(raw).ok, name).toBe(false);
  });
});

describe('nextBackupKey', () => {
  it('没有备份时从 1 起；取已有最大序号加 1；只看键名', () => {
    expect(nextBackupKey({ keys: () => [PRIMARY_KEY] })).toBe('ub:backup:1');
    expect(nextBackupKey({ keys: () => ['ub:backup:1', 'ub:backup:7', 'ub:backup:3', 'ub:backup:x', 'ub:backup:2a', PRIMARY_KEY] })).toBe('ub:backup:8');
  });
});

describe('backupAndStartFresh', () => {
  it('成功：先备份并读回，之后才写主键；备份逐字符等于原文，主键是新空存档', () => {
    const raw = BAD_SAVES['invalid-json']!;
    const kv = faultyKv({ [PRIMARY_KEY]: raw });
    const result = backupAndStartFresh(kv, raw, fresh);
    expect(result).toEqual({ ok: true, backupKey: 'ub:backup:1' });
    expect(kv.attempts.map((a) => a.key)).toEqual(['ub:backup:1', PRIMARY_KEY]);
    expect(kv.peek('ub:backup:1')).toBe(raw);
    expect(kv.peek(PRIMARY_KEY)).toBe(freshText);
  });

  it('不覆盖旧备份：序号递增，旧备份内容不变', () => {
    const raw = 'broken';
    const kv = faultyKv({ [PRIMARY_KEY]: raw, 'ub:backup:1': 'older one', 'ub:backup:4': 'older four' });
    const r1 = backupAndStartFresh(kv, raw, fresh);
    expect(r1).toEqual({ ok: true, backupKey: 'ub:backup:5' });
    expect(kv.peek('ub:backup:1')).toBe('older one');
    expect(kv.peek('ub:backup:4')).toBe('older four');
    expect(kv.attempts.filter((a) => a.key.startsWith('ub:backup:')).map((a) => a.key)).toEqual(['ub:backup:5']);
    const r2 = backupAndStartFresh(kv, raw, fresh);
    expect(r2).toEqual({ ok: true, backupKey: 'ub:backup:6' });
    expect(kv.peek('ub:backup:5')).toBe(raw);
  });

  it('Feature: unfinished-business, Property 16: 备份失败时主键不变', () => {
    const modes = {
      'write-throws': { setThrows: (k: string) => k.startsWith('ub:backup:') },
      'read-differs': { getAs: (k: string, real: string | null) => (k.startsWith('ub:backup:') ? `${real ?? ''} ` : undefined) },
      'read-throws': { getAs: (k: string) => (k.startsWith('ub:backup:') ? ('throw' as const) : undefined) },
      'read-null': { getAs: (k: string) => (k.startsWith('ub:backup:') ? null : undefined) },
    };
    fc.assert(
      fc.property(rawArb, fc.constantFrom(...Object.keys(modes) as (keyof typeof modes)[]), (raw, mode) => {
        const kv = faultyKv({ [PRIMARY_KEY]: raw }, modes[mode]);
        const result = backupAndStartFresh(kv, raw, fresh);
        expect(result.ok).toBe(false);
        expect(result.ok === false && ['backup-write-failed', 'backup-mismatch']).toContain(result.ok === false ? result.error : '');
        expect(kv.attempts.some((a) => a.key === PRIMARY_KEY)).toBe(false);
        expect(kv.peek(PRIMARY_KEY)).toBe(raw);
      }),
      { numRuns: 100 },
    );
  });

  it('Feature: unfinished-business, Property 17: 备份成功前不写主键', () => {
    fc.assert(
      fc.property(rawArb, (raw) => {
        // 页面启动与恢复界面渲染阶段：读到坏存档，主键与备份键一次都不写，等多久都一样。
        const idle = faultyKv({ [PRIMARY_KEY]: raw });
        const clock = createFakeClock();
        const booted = createPersistentStore({ storage: storageOf(idle), env, clock });
        booted.flush();
        clock.advance(60_000);
        expect(idle.attempts).toEqual([]);
        expect(idle.peek(PRIMARY_KEY)).toBe(raw);

        // 备份阶段：主键的任何写入都发生在备份写入且读回一致之后。
        const kv = faultyKv({ [PRIMARY_KEY]: raw });
        backupAndStartFresh(kv, raw, fresh);
        const keys = kv.attempts.map((a) => a.key);
        expect(keys.indexOf('ub:backup:1')).toBe(0);
        expect(keys.indexOf(PRIMARY_KEY)).toBeGreaterThan(0);
        expect(kv.peek('ub:backup:1')).toBe(raw);
      }),
      { numRuns: 100 },
    );
  });

  it('Feature: unfinished-business, Property 20: 新存档写入后必须读回一致才算成功', () => {
    const modes = {
      'primary-write-failed': { setThrows: (k: string, v: string) => k === PRIMARY_KEY && v === freshText },
      'primary-readback-failed': { getAs: (k: string) => (k === PRIMARY_KEY ? ('throw' as const) : undefined) },
      'primary-readback-null': { getAs: (k: string) => (k === PRIMARY_KEY ? null : undefined) },
      'primary-mismatch': { getAs: (k: string, real: string | null) => (k === PRIMARY_KEY ? `${real ?? ''}!` : undefined) },
    };
    const expected = {
      'primary-write-failed': 'primary-write-failed',
      'primary-readback-failed': 'primary-readback-failed',
      'primary-readback-null': 'primary-readback-failed',
      'primary-mismatch': 'primary-mismatch',
    } as const;
    fc.assert(
      fc.property(rawArb, fc.constantFrom(...Object.keys(modes) as (keyof typeof modes)[]), (raw, mode) => {
        const kv = faultyKv({ [PRIMARY_KEY]: raw, 'ub:backup:2': 'older' }, modes[mode]);
        const result = backupAndStartFresh(kv, raw, fresh);
        expect(result).toEqual({ ok: false, error: expected[mode] });
        expect(kv.peek('ub:backup:3')).toBe(raw);
        expect(kv.peek('ub:backup:2')).toBe('older');
        expect(kv.peek(PRIMARY_KEY)).toBe(raw);
      }),
      { numRuns: 100 },
    );
    // 返回 ok 的执行：紧随最后一次主键写入的读回，与写入内容逐字符相等。
    fc.assert(
      fc.property(rawArb, (raw) => {
        const kv = faultyKv({ [PRIMARY_KEY]: raw });
        const result = backupAndStartFresh(kv, raw, fresh);
        expect(result.ok).toBe(true);
        const lastWrite = kv.attempts.filter((a) => a.key === PRIMARY_KEY).at(-1)!;
        expect(kv.getItem(PRIMARY_KEY)).toBe(lastWrite.value);
      }),
      { numRuns: 100 },
    );
  });

  it('还原也失败时仍保留备份，也不抛出', () => {
    const raw = 'broken';
    const kv = faultyKv({ [PRIMARY_KEY]: raw }, { setThrows: (k) => k === PRIMARY_KEY });
    const result = backupAndStartFresh(kv, raw, fresh);
    expect(result).toEqual({ ok: false, error: 'primary-write-failed' });
    expect(kv.peek('ub:backup:1')).toBe(raw);
    expect(kv.peek(PRIMARY_KEY)).toBe(raw);
    expect(kv.attempts.filter((a) => a.key === PRIMARY_KEY)).toHaveLength(2); // 写新的 + 尽力还原
  });

  it('读回走样且还原也失败：备份保留，不报成功', () => {
    const raw = 'broken';
    const kv = faultyKv(
      { [PRIMARY_KEY]: raw },
      { setThrows: (k, v) => k === PRIMARY_KEY && v === raw, getAs: (k, real) => (k === PRIMARY_KEY ? `${real}?` : undefined) },
    );
    const result = backupAndStartFresh(kv, raw, fresh);
    expect(result.ok).toBe(false);
    expect(kv.peek('ub:backup:1')).toBe(raw);
  });

  it('列键名就抛错：当作备份写不了，什么都没写', () => {
    const kv = faultyKv({ [PRIMARY_KEY]: 'broken' });
    kv.keys = () => {
      throw new Error('nope');
    };
    expect(backupAndStartFresh(kv, 'broken', fresh)).toEqual({ ok: false, error: 'backup-write-failed' });
    expect(kv.attempts).toHaveLength(0);
  });

  it('Feature: unfinished-business, Property 18: 备份内容逐字符相等且不覆盖旧备份', () => {
    fc.assert(
      fc.property(rawArb, fc.array(fc.nat({ max: 20 }), { maxLength: 4 }), (raw, olds) => {
        const initial: Record<string, string> = { [PRIMARY_KEY]: raw };
        for (const n of olds) initial[`ub:backup:${n}`] = `old ${n}`;
        const kv = faultyKv(initial);
        const result = backupAndStartFresh(kv, raw, fresh);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(kv.peek(result.backupKey)).toBe(raw);
        expect(Object.keys(initial)).not.toContain(result.backupKey);
        expect(kv.peek(PRIMARY_KEY)).toBe(freshText);
        for (const n of olds) expect(kv.peek(`ub:backup:${n}`)).toBe(`old ${n}`);
      }),
      { numRuns: 100 },
    );
  });
});

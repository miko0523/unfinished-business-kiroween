import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { codePointLength, validateCriteria, validateMemo, validateStepTitle, validateTitle } from '../src/domain/validate';

describe('码点计数', () => {
  it('emoji 与组合字符按码点计数', () => {
    expect(codePointLength('😀')).toBe(1);
    expect(codePointLength('😀'.repeat(80))).toBe(80);
    expect('😀'.repeat(80).length).toBe(160); // UTF-16 长度会误判
    expect(codePointLength('e\u0301')).toBe(2); // e + 组合重音
    expect(validateTitle('😀'.repeat(80)).ok).toBe(true);
    expect(validateTitle('😀'.repeat(81)).ok).toBe(false);
  });

  it('全角空格与普通空白都被去除', () => {
    expect(validateTitle('\u3000\u3000 \t\n').ok).toBe(false);
    const r = validateTitle('\u3000 hello \u3000');
    expect(r).toEqual({ ok: true, value: 'hello' });
    expect(validateStepTitle(' \u3000 ').ok).toBe(false);
  });
});

describe('Feature: unfinished-business, Property 6: 输入校验', () => {
  it('标题 trim 后 1–80 才通过，否则被拒', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 200 }), (s) => {
        const n = codePointLength(s.trim());
        const r = validateTitle(s);
        expect(r.ok).toBe(n >= 1 && n <= 80);
        if (r.ok) expect(r.value).toBe(s.trim());
      }),
      { numRuns: 200 },
    );
  });

  it('步骤标题同样 1–80', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 200 }), (s) => {
        const n = codePointLength(s.trim());
        expect(validateStepTitle(s).ok).toBe(n >= 1 && n <= 80);
      }),
      { numRuns: 200 },
    );
  });

  it('完成条件 ≤200、留言 ≤140，可为空', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 300 }), (s) => {
        const n = codePointLength(s);
        expect(validateCriteria(s).ok).toBe(n <= 200);
        expect(validateMemo(s).ok).toBe(n <= 140);
      }),
      { numRuns: 200 },
    );
    expect(validateCriteria('').ok).toBe(true);
    expect(validateMemo('').ok).toBe(true);
  });
});

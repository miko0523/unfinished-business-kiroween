// 输入校验：长度按去首尾空白后的 Unicode 码点计算（criteria 与 memo 按原文码点计，不 trim）。
import type { UserError } from './types';

export const TITLE_MAX = 80;
export const STEP_TITLE_MAX = 80;
export const CRITERIA_MAX = 200;
export const MEMO_MAX = 140;
export const STEPS_MAX = 50;

/** Unicode 码点数（emoji、组合字符序列中的每个码点各计 1）。 */
export function codePointLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

export type Checked<T> = { ok: true; value: T } | { ok: false; error: UserError };

/** 标题：trim 后 1–80。 */
export function validateTitle(raw: string): Checked<string> {
  const value = raw.trim();
  const length = codePointLength(value);
  if (length === 0) return { ok: false, error: { kind: 'title-empty', max: TITLE_MAX } };
  if (length > TITLE_MAX) return { ok: false, error: { kind: 'title-too-long', length, max: TITLE_MAX } };
  return { ok: true, value };
}

/** 步骤标题：trim 后 1–80。 */
export function validateStepTitle(raw: string): Checked<string> {
  const value = raw.trim();
  const length = codePointLength(value);
  if (length === 0) return { ok: false, error: { kind: 'step-empty', max: STEP_TITLE_MAX } };
  if (length > STEP_TITLE_MAX) return { ok: false, error: { kind: 'step-too-long', length, max: STEP_TITLE_MAX } };
  return { ok: true, value };
}

/** 完成条件：0–200，不强制 trim。 */
export function validateCriteria(raw: string): Checked<string> {
  const length = codePointLength(raw);
  if (length > CRITERIA_MAX) return { ok: false, error: { kind: 'criteria-too-long', length, max: CRITERIA_MAX } };
  return { ok: true, value: raw };
}

/** 留言：0–140，可留空。 */
export function validateMemo(raw: string): { ok: true; value: string } | { ok: false; length: number; max: number } {
  const length = codePointLength(raw);
  if (length > MEMO_MAX) return { ok: false, length, max: MEMO_MAX };
  return { ok: true, value: raw };
}

/** 再添加一个步骤是否还有名额。 */
export function canAddStep(currentCount: number): boolean {
  return currentCount < STEPS_MAX;
}

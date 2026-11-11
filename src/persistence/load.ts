// 启动时只读：决定从哪份数据开始。这里绝不写入任何键。
import { emptyState } from '../domain/types';
import { PRIMARY_KEY } from './keys';
import { parseSave } from './parse';
import type { KeyValueStore } from './storage';
import type { ParseError, SaveData } from './types';

export type LoadOutcome =
  /** 没有存档：空数据只在内存里，首次变更才写。 */
  | { kind: 'fresh'; data: SaveData }
  | { kind: 'loaded'; data: SaveData }
  /** 读到了东西但不能用：原文原样保留，等玩家主动处理（阶段 7）。 */
  | { kind: 'recovery'; raw: string; error: ParseError }
  /** 本地存储不可用：只在内存里继续。 */
  | { kind: 'unavailable' };

export function loadSave(kv: KeyValueStore | null): LoadOutcome {
  if (!kv) return { kind: 'unavailable' };
  let raw: string | null;
  try {
    raw = kv.getItem(PRIMARY_KEY);
  } catch {
    return { kind: 'unavailable' };
  }
  if (raw === null) return { kind: 'fresh', data: emptyState() };
  const parsed = parseSave(raw);
  if (parsed.ok) return { kind: 'loaded', data: parsed.value };
  return { kind: 'recovery', raw, error: parsed.error };
}

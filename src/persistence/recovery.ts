// 坏存档恢复的纯逻辑：选项③的备份、新空存档与读回校验。存储由调用方注入。
// 只有这里（备份成功之后）才允许在恢复期间碰主键；其余恢复路径一个键都不写。
import { BACKUP_PREFIX, PRIMARY_KEY } from './keys';
import { serializeSave } from './serialize';
import type { KeyValueStore } from './storage';
import type { SaveData } from './types';

/** 错误码只给代码与测试用，界面不显示。 */
export type RecoveryError =
  | 'backup-write-failed'
  | 'backup-mismatch'
  | 'primary-write-failed'
  | 'primary-readback-failed'
  | 'primary-mismatch';

export type RecoveryResult = { ok: true; backupKey: string } | { ok: false; error: RecoveryError };

/** 备份阶段的失败：主键从未被碰过。 */
export const isBackupStageError = (e: RecoveryError): boolean => e === 'backup-write-failed' || e === 'backup-mismatch';

const BACKUP_NUMBER = /^ub:backup:(\d+)$/;

/** 下一个不冲突的备份键：已有序号的最大值加 1（从 1 起）。只读键名，不读内容。可能抛出。 */
export function nextBackupKey(kv: Pick<KeyValueStore, 'keys'>): string {
  const names = kv.keys();
  const taken = new Set(names);
  let max = 0;
  for (const name of names) {
    const m = BACKUP_NUMBER.exec(name);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isSafeInteger(n) && n > max) max = n;
  }
  let next = max + 1;
  while (taken.has(`${BACKUP_PREFIX}${next}`)) next += 1;
  return `${BACKUP_PREFIX}${next}`;
}

/** 尽力把主键还原成原始文本；不抛，不碰备份。 */
function restorePrimary(kv: KeyValueStore, raw: string): void {
  try {
    kv.setItem(PRIMARY_KEY, raw);
  } catch {
    /* 还原不了也不要紧，备份还在 */
  }
}

/**
 * 先把 raw 原样备份并逐字符读回，一致之后才把 fresh 写进主键并读回比对。
 * 唯一的成功出口是最后一步读回一致；任何失败都不删除已写入的备份。
 */
export function backupAndStartFresh(kv: KeyValueStore, raw: string, fresh: SaveData): RecoveryResult {
  let key: string;
  try {
    key = nextBackupKey(kv);
    kv.setItem(key, raw);
  } catch {
    return { ok: false, error: 'backup-write-failed' };
  }
  let echoedBackup: string | null = null;
  try {
    echoedBackup = kv.getItem(key);
  } catch {
    /* 视为读回失败 */
  }
  if (echoedBackup !== raw) return { ok: false, error: 'backup-mismatch' };

  // 备份已确认。到这里才允许写主键。
  const freshText = serializeSave(fresh);
  try {
    kv.setItem(PRIMARY_KEY, freshText);
  } catch {
    restorePrimary(kv, raw);
    return { ok: false, error: 'primary-write-failed' };
  }
  let echoed: string | null = null;
  try {
    echoed = kv.getItem(PRIMARY_KEY);
  } catch {
    /* 视为读回失败 */
  }
  if (echoed !== freshText) {
    restorePrimary(kv, raw);
    return { ok: false, error: echoed === null ? 'primary-readback-failed' : 'primary-mismatch' };
  }
  return { ok: true, backupKey: key };
}

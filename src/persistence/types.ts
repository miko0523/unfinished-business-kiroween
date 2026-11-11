import type { AppState } from '../domain/types';

/** 存档里的数据与运行时的 AppState 同形；schema_version 只在文本里出现。 */
export type SaveData = AppState;

export type ParseError =
  | { kind: 'not-json' }
  | { kind: 'not-object' }
  | { kind: 'unsupported-version' }
  | { kind: 'invalid'; path: string };

export type ParseResult = { ok: true; value: SaveData } | { ok: false; error: ParseError };

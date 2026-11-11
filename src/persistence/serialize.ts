import type { SaveData } from './types';
import { SCHEMA_VERSION } from './keys';

/** 完整存档的 JSON 文本（字段顺序固定，便于比对）。 */
export function serializeSave(d: SaveData): string {
  return JSON.stringify({
    schema_version: SCHEMA_VERSION,
    tasks: d.tasks,
    archive: d.archive,
    house: d.house,
    settings: d.settings,
    nextGhostNo: d.nextGhostNo,
    ...(d.collection ? { collection: d.collection } : {}),
  });
}

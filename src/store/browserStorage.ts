import type { StorageLike } from '../persistence/storage';

/** 浏览器的 localStorage；被禁用或访问会抛错时返回 null。 */
export function getBrowserStorage(): StorageLike | null {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

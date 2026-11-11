import type { AppState } from '../domain/types';
import { serializeSave } from '../persistence/serialize';
import type { StoragePort } from './storagePort';

/** Keep the guarantee in the previous save if a creation cannot be verified. */
export function persistCreation(port: StoragePort, previous: AppState, next: AppState): boolean {
  const text = serializeSave(next);
  try {
    port.write(text);
    if (port.readBack() === text) return true;
  } catch {
    // A failed read can follow a successful write. Restore before reporting rejection.
  }
  try { port.write(serializeSave(previous)); } catch { /* Atomic storage writes leave the previous value on rejection. */ }
  return false;
}

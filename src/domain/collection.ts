import type { AppState, Env, GhostKind } from './types';

export const STAMPS = ['envelope', 'key', 'cup', 'crane', 'boat', 'candle', 'moon', 'kite', 'watch', 'umbrella', 'seed', 'door'] as const;
export type StampKind = typeof STAMPS[number];
export const COLLECTION_SIZE = STAMPS.length;
export const LANTERN_CHANCE = 0.05;

export const collectedCount = (completed: number): number => Math.min(COLLECTION_SIZE, Math.max(0, Math.floor(completed)));
export const stampFor = (ordinal: number): StampKind => STAMPS[ordinal % COLLECTION_SIZE] ?? STAMPS[0];
export const lanternDue = (state: AppState): boolean => state.house.completedCount >= COLLECTION_SIZE && !state.collection?.lanternWelcomed;

/** Called only after creation validation; never changes an existing resident. */
export function newGhostKind(state: AppState, env: Env): GhostKind {
  if (state.house.completedCount < COLLECTION_SIZE) return 'ordinary';
  if (lanternDue(state)) return 'lantern';
  const value = env.random?.() ?? 1;
  return Number.isFinite(value) && value >= 0 && value < LANTERN_CHANCE ? 'lantern' : 'ordinary';
}

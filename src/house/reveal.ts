/** Zero-based cells, in a 400×300 painting divided into 4×3 opaque tiles. */
export const REVEAL_ORDER = [0, 3, 8, 11, 1, 2, 4, 7, 9, 10, 5, 6] as const;
export const PORTRAIT = { x: 88, y: -15, width: 224, height: 288 } as const;
export const revealRank = (cell: number): number => REVEAL_ORDER.findIndex((value) => value === cell) + 1;

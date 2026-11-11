import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 测试里直接读 atlas.json，不经过 src，作为独立的核对来源。
interface AtlasModule {
  id: string;
  logicalSize: [number, number];
  topJoin: number;
  bottomJoin: number;
}
const atlas = JSON.parse(readFileSync(resolve('public/assets/dollhouse/atlas.json'), 'utf8')) as {
  logicalWidth: number;
  modules: AtlasModule[];
};

export const LOGICAL_WIDTH = atlas.logicalWidth;
export const JOINS: Record<string, { topJoin: number; bottomJoin: number }> = Object.fromEntries(
  atlas.modules.map((m) => [m.id, { topJoin: m.topJoin, bottomJoin: m.bottomJoin }]),
);
export const STACK_6 = ['lobby', 'floor-01', 'floor-02', 'floor-03', 'floor-04', 'floor-05', 'roof'] as const;

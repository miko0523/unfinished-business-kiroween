// 各模块的尺寸与拼接线，派生自 generated.ts（静态抄自 public/assets/dollhouse/atlas.json）：
//   logicalWidth → width；modules[].logicalSize[1] → height；modules[].topJoin / bottomJoin；wallAnchorsX。
// dx 初值取自 design.md 的水平偏移表（不是素材数据），roof 的 dx 在 layoutHouse 中跟随最顶楼层。
import { ATLAS as atlas } from './generated';
import { MODULE_IDS, isModuleId, type ModuleId } from '../assets';

export interface ModuleGeometry {
  id: ModuleId;
  width: number;
  height: number;
  topJoin: number;
  bottomJoin: number;
  /** 固定水平偏移；roof 为 null，表示跟随最顶楼层。 */
  dx: number | null;
}

/** design.md「轻微确定性错位」表。 */
export const DX_TABLE: Readonly<Record<ModuleId, number | null>> = {
  lobby: 0,
  'floor-01': 0,
  'floor-02': 3,
  'floor-03': -3,
  'floor-04': 4,
  'floor-05': -2,
  roof: null,
};

function build(): Record<ModuleId, ModuleGeometry> {
  const out: Partial<Record<ModuleId, ModuleGeometry>> = {};
  for (const m of atlas.modules) {
    if (!isModuleId(m.id)) throw new Error(`atlas.json: unknown module id ${m.id}`);
    const [w, h] = m.logicalSize;
    if (h === undefined) throw new Error(`atlas: ${m.id} missing height`);
    if (w !== atlas.logicalWidth) throw new Error(`atlas.json: ${m.id} width ${w} != logicalWidth`);
    out[m.id] = { id: m.id, width: w, height: h!, topJoin: m.topJoin, bottomJoin: m.bottomJoin, dx: DX_TABLE[m.id] };
  }
  for (const id of MODULE_IDS) {
    if (!out[id]) throw new Error(`atlas.json: missing module ${id}`);
  }
  return out as Record<ModuleId, ModuleGeometry>;
}

export const LOGICAL_WIDTH: number = atlas.logicalWidth;
export const WALL_ANCHORS_X: readonly [number, number] = [atlas.wallAnchorsX[0]!, atlas.wallAnchorsX[1]!];
export const MODULES: Readonly<Record<ModuleId, ModuleGeometry>> = build();

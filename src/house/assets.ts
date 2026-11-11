// 模块 id → 公开目录中的静态素材。纯函数，不触碰 DOM。

export const MODULE_IDS = ['roof', 'lobby', 'floor-01', 'floor-02', 'floor-03', 'floor-04', 'floor-05'] as const;
export type ModuleId = (typeof MODULE_IDS)[number];
export type FloorModuleId = Extract<ModuleId, `floor-${string}`>;

/** 逻辑宽度（1x）；2x 为两倍。 */
export const WIDTH_1X = 801;
export const WIDTH_2X = 1602;

/** 公开目录下的素材根（相对于站点 base）。 */
export const ASSET_DIR = 'assets/dollhouse';

export function isModuleId(value: string): value is ModuleId {
  return (MODULE_IDS as readonly string[]).includes(value);
}

/** 楼层 2 至 6 映射到 floor-01 至 floor-05。 */
export function floorModuleForFloor(floor: number): FloorModuleId {
  if (!Number.isInteger(floor) || floor < 2 || floor > 6) {
    throw new RangeError(`floor must be an integer in 2..6, got ${floor}`);
  }
  return `floor-0${floor - 1}` as FloorModuleId;
}

/** 已长出 grownFloors 层时还没有出现的楼层模块，按长出顺序排列（grownFloors 为 6 时为空）。 */
export function pendingFloorModules(grownFloors: number): readonly FloorModuleId[] {
  const out: FloorModuleId[] = [];
  for (let floor = Math.max(3, Math.floor(grownFloors) + 1); floor <= 6; floor++) out.push(floorModuleForFloor(floor));
  return out;
}

/** 相对公开目录根的路径，如 `assets/dollhouse/1x/lobby.png`。 */
export function assetPath(id: ModuleId, scale: 1 | 2): string {
  return `${ASSET_DIR}/${scale}x/${id}.png`;
}

function joinBase(base: string, path: string): string {
  return base.endsWith('/') ? base + path : `${base}/${path}`;
}

/** `base` 默认取构建时的 BASE_URL；在 `base: './'` 下结果保持相对路径。 */
export function srcFor(id: ModuleId, base: string = import.meta.env.BASE_URL): string {
  return joinBase(base, assetPath(id, 1));
}

export function srcsetFor(id: ModuleId, base: string = import.meta.env.BASE_URL): string {
  return `${joinBase(base, assetPath(id, 1))} ${WIDTH_1X}w, ${joinBase(base, assetPath(id, 2))} ${WIDTH_2X}w`;
}

export function sizesFor(stageWidthPx: number): string {
  return `${stageWidthPx}px`;
}

/** 每个模块的加载失败标志；界面据此用纯色底板顶替。 */
export interface LoadFailureTracker {
  markFailed(id: ModuleId): void;
  hasFailed(id: ModuleId): boolean;
  failedIds(): readonly ModuleId[];
}

export function createLoadFailureTracker(): LoadFailureTracker {
  const failed = new Set<ModuleId>();
  return {
    markFailed: (id) => void failed.add(id),
    hasFailed: (id) => failed.has(id),
    failedIds: () => MODULE_IDS.filter((id) => failed.has(id)),
  };
}

/**
 * 派生的灯笼组件（透明 PNG，由门厅图右侧的小灯笼用图像编辑工具提取，带轻微重采样，不是逐像素裁切）。
 * 相对公开目录根的路径；组件的像素尺寸固定为 1024×1536（宽高比 2:3）。
 */
export const LANTERN_PATH = `${ASSET_DIR}/components/lantern.png`;
export const LANTERN_ASPECT = 1024 / 1536;

export function lanternSrc(base: string = import.meta.env.BASE_URL): string {
  return joinBase(base, LANTERN_PATH);
}

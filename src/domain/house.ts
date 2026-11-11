// 暖灯数量：每送走一只 Ghost 增加一盏，最多 12 盏；只由累计完成数决定，不依赖时间，删除未完成 Task 不影响。
export const MAX_LAMPS = 12;

export function lampsFor(completedCount: number): number {
  return Math.min(MAX_LAMPS, Math.max(0, Math.floor(completedCount)));
}

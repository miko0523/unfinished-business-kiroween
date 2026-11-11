// 聚焦顺序：楼层从上到下（降序），同层从左到右（slot 升序）。
import type { FloorNo, Task } from '../domain/types';

export function residentOrder<T extends Pick<Task, 'slot'>>(tasks: readonly T[]): T[] {
  return [...tasks].sort((a, b) => b.slot.floor - a.slot.floor || a.slot.slot - b.slot.slot);
}

export interface ResidentFloor<T> {
  floor: FloorNo;
  /** 同层从左到右。 */
  residents: T[];
}

/** 按楼层分组，只含有住客的楼层；楼层从高到低，组内从左到右（与 residentOrder 的整体顺序一致）。 */
export function residentFloors<T extends Pick<Task, 'slot'>>(tasks: readonly T[]): ResidentFloor<T>[] {
  const out: ResidentFloor<T>[] = [];
  for (const task of residentOrder(tasks)) {
    const last = out[out.length - 1];
    if (last && last.floor === task.slot.floor) last.residents.push(task);
    else out.push({ floor: task.slot.floor, residents: [task] });
  }
  return out;
}

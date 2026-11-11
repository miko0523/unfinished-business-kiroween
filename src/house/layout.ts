// 静态堆叠：以门厅顶边为原点（y=0，向上为负），自下而上累加。
//   y(floor-0k) = y(下方模块) + topJoin(下方模块) − bottomJoin(floor-0k)
//   y(roof)     = y(最顶楼层) + topJoin(最顶楼层) − bottomJoin(roof)
//   舞台高度    = lobby.height − y(roof)
// 结果只取决于 grownFloors；不读时间，不用随机数。
import { floorModuleForFloor, type ModuleId } from './assets';
import { MODULES } from './data/modules';

export type GrownFloors = 2 | 3 | 4 | 5 | 6;

export interface PlacedModule {
  id: ModuleId;
  y: number;
  dx: number;
  width: number;
  height: number;
}

export interface HouseLayout {
  grownFloors: GrownFloors;
  /** 绘制顺序：下方先画，上方后画（lobby、floor-01…、roof）。 */
  modules: readonly PlacedModule[];
  roofY: number;
  stageHeight: number;
}

export function layoutHouse(grownFloors: number): HouseLayout {
  if (!Number.isInteger(grownFloors) || grownFloors < 2 || grownFloors > 6) {
    throw new RangeError(`grownFloors must be an integer in 2..6, got ${grownFloors}`);
  }
  const lobby = MODULES.lobby;
  const placed: PlacedModule[] = [{ id: 'lobby', y: 0, dx: lobby.dx ?? 0, width: lobby.width, height: lobby.height }];

  for (let floor = 2; floor <= grownFloors; floor++) {
    const id = floorModuleForFloor(floor);
    const below = placed[placed.length - 1]!;
    const g = MODULES[id];
    placed.push({
      id,
      y: below.y + MODULES[below.id].topJoin - g.bottomJoin,
      dx: g.dx ?? 0,
      width: g.width,
      height: g.height,
    });
  }

  const top = placed[placed.length - 1]!;
  const roof = MODULES.roof;
  const roofY = top.y + MODULES[top.id].topJoin - roof.bottomJoin;
  placed.push({ id: 'roof', y: roofY, dx: top.dx, width: roof.width, height: roof.height });

  return {
    grownFloors: grownFloors as GrownFloors,
    modules: placed,
    roofY,
    stageHeight: lobby.height - roofY,
  };
}

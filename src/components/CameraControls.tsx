import { useEffect } from 'preact/hooks';
import { focusScrollDelta, WIDE_MIN } from '../house/viewport';
import { floorModuleForFloor } from '../house/assets';
import { layoutHouse, type GrownFloors } from '../house/layout';
import { STAGE_WIDTH, stageBoxes } from '../house/stage';
import { useCopy } from './useCopy';
import { useAppContext } from '../store/StoreContext';
import { useStore } from '../store/useStore';
import { useReducedMotion } from './useReducedMotion';
import { useViewport } from './useViewport';

/** 手机上当前聚焦的楼层：最近被创建、点击或勾选的 Ghost 所在楼层；还没有时取有住客的最低楼层；没有住客取二楼。 */
export function activeFloor(focusFloor: number | null, residentFloors: readonly number[]): number {
  if (focusFloor !== null) return focusFloor;
  return residentFloors.length > 0 ? Math.min(...residentFloors) : 2;
}

/**
 * 手机镜头（宽屏不显示也不起作用）：
 * - “看全景 / 回到当前楼层”按钮；进入全景时详情收起。
 * - 聚焦模式下，把当前活动楼层滚进视口；全景模式下滚到旧宅顶部。
 * - 最近被创建、勾选的 Ghost 所在楼层成为当前楼层。
 * 宽屏下镜头固定为聚焦，旧宅宽度不因任何选中而改变。
 */
export function CameraControls({ grownFloors }: { grownFloors: GrownFloors }) {
  const t = useCopy();
  const { store, ui } = useAppContext();
  const { w, h } = useViewport();
  const reduced = useReducedMotion();
  const camera = useStore(ui, (s) => s.camera);
  const focusFloor = useStore(ui, (s) => s.focusFloor);
  const floors = useStore(store, (s) => s.tasks.map((x) => x.slot.floor).join(','));
  const wide = w >= WIDE_MIN;
  const active = activeFloor(focusFloor, floors ? floors.split(',').map(Number) : []);

  // 宽屏没有全景：别让窄屏留下的镜头状态吞掉第一次点击。
  useEffect(() => {
    if (wide) ui.setCamera('focus');
  }, [wide, ui]);

  // 新住客、勾选：那一层成为当前楼层。
  useEffect(
    () =>
      store.subscribeEvents((events) => {
        for (const e of events) {
          if (e.type === 'GhostMovedIn' || e.type === 'StepChecked') ui.setFocusFloor(e.slot.floor);
        }
      }),
    [store, ui],
  );

  useEffect(() => {
    if (wide) return;
    const house = document.querySelector<HTMLElement>('.house');
    if (!house) return;
    const behavior: ScrollBehavior = reduced ? 'auto' : 'smooth';
    const rect = house.getBoundingClientRect();
    if (camera === 'panorama') {
      if (rect.top < 0) window.scrollBy({ top: Math.round(rect.top - 8), behavior });
      return;
    }
    const layout = layoutHouse(grownFloors);
    const box = stageBoxes(layout).find((b) => b.id === floorModuleForFloor(Math.min(active, grownFloors)));
    if (!box) return;
    const k = rect.width / STAGE_WIDTH;
    const delta = focusScrollDelta(rect.top + box.y * k, rect.top + (box.y + box.h) * k, window.innerHeight);
    if (delta !== 0) window.scrollBy({ top: delta, behavior });
  }, [wide, camera, active, grownFloors, reduced, h]);

  if (wide) return null;
  const panorama = camera === 'panorama';
  return (
    <button type="button" class="view-toggle" aria-pressed={panorama} onClick={() => ui.setCamera(panorama ? 'focus' : 'panorama')}>
      {t(panorama ? 'view.focus' : 'view.panorama')}
    </button>
  );
}

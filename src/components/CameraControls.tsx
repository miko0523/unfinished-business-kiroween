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
 * 镜头（手机与宽屏都有）：
 * - “看全景 / 回到当前楼层”按钮；进入全景时详情收起。
 * - 聚焦模式下，把当前活动楼层滚进视口；全景模式下滚到旧宅顶部。
 * - 最近被创建、勾选的 Ghost 所在楼层成为当前楼层。
 * 旧宅宽度不因任何选中而改变；全景才按视口高度缩放，退出后回到默认大小。
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
    // 宽屏的聚焦视图不滚动（左栏常驻、旧宅较小）；全景则回到旧宅顶部。
    if (wide && camera !== 'panorama') return;
    const house = document.querySelector<HTMLElement>('.house');
    // 旧宅藏起来时（比如在纪念册里）不动镜头：量到的位置全是 0，会把别的页面往回推。
    // iPhone Safari 往下划时地址栏收起、视口变高，也会叫醒这里。
    if (!house || house.closest('[hidden]')) return;
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

  const panorama = camera === 'panorama';
  const label = t(panorama ? 'view.focus' : 'view.panorama');
  return (
    <button
      type="button"
      class="view-toggle"
      aria-pressed={panorama}
      aria-label={label}
      title={label}
      onClick={() => ui.setCamera(panorama ? 'focus' : 'panorama')}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
        <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          {panorama ? (
            <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
          ) : (
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          )}
        </g>
      </svg>
    </button>
  );
}

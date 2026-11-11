import { useEffect, useRef, useState } from 'preact/hooks';
import { lampsFor } from '../domain/house';
import { LOBBY } from '../house/data/lobby';
import type { Rect } from '../house/data/slots';
import { layoutHouse, type GrownFloors } from '../house/layout';
import { STAGE_WIDTH, stageBoxes } from '../house/stage';
import { useAppContext } from '../store/StoreContext';
import { useStore } from '../store/useStore';
import { HUNG_H, HUNG_W, HungLamp, StaticLampLight } from './LampArt';
import { useLanternWelcome } from './useLanternWelcome';

export interface WarmLampsProps {
  grownFloors: GrownFloors;
}

/** 刚点亮的那一盏的“新亮起”效果保留多久（淡入加小星）。 */
const FRESH_MS = 1600;

/**
 * 门厅里的暖灯：数量只由累计完成数决定（最多 12，删除不加不减，刷新一致）。
 * 前 3 盏叠在门厅原画里已有的三盏小灯笼上，后 9 盏是挂在墙上的灯笼组件。
 * 庆祝中，新灯要等飞行最后 0.5 秒才亮；初始化与刷新只显示现有的灯，不补播。
 */
export function WarmLamps({ grownFloors }: WarmLampsProps) {
  const { store, ui } = useAppContext();
  const welcoming = useLanternWelcome(store);
  const completed = useStore(store, (s) => s.house.completedCount);
  const celebration = useStore(ui, (s) => s.celebration);
  const [fresh, setFresh] = useState<{ from: number; to: number } | null>(null);
  const shown = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const holdBack = celebration && !celebration.lampOn && lampsFor(completed) > lampsFor(completed - 1) ? 1 : 0;
  const visible = lampsFor(completed) - holdBack;

  useEffect(() => {
    const before = shown.current;
    shown.current = visible;
    if (before === null || visible <= before) return;
    setFresh({ from: before, to: visible });
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFresh(null), FRESH_MS);
  }, [visible]);
  useEffect(() => () => void (timer.current !== null && clearTimeout(timer.current)), []);

  const slots = LOBBY.lampSlots;
  const rects = LOBBY.staticLampRects;
  if (slots.status !== 'derived' || rects.status !== 'derived') return null;
  const layout = layoutHouse(grownFloors);
  const lobby = stageBoxes(layout).find((b) => b.id === 'lobby');
  if (!lobby) return null;
  const pct = (x: number, y: number) => ({ left: `${((lobby.x + x) / STAGE_WIDTH) * 100}%`, top: `${((lobby.y + y) / layout.stageHeight) * 100}%` });
  const size = (w: number, h: number) => ({ width: `${(w / STAGE_WIDTH) * 100}%`, height: `${(h / layout.stageHeight) * 100}%` });

  return (
    <div class="warm-lamps" aria-hidden="true" data-lamps={visible} data-welcoming={welcoming ? 'true' : 'false'}>
      {slots.slots.slice(0, visible).map((s, i) => {
        const isNew = fresh !== null && i >= fresh.from && i < fresh.to;
        const cls = `warm-lamp${isNew ? ' warm-lamp-new' : ''}`;
        if (s.kind === 'static-lantern') {
          const r = rects.rects.find((q) => Math.round((q[0] + q[2]) / 2) === s.x && Math.round((q[1] + q[3]) / 2) === s.y) as Rect | undefined;
          if (!r) return null;
          return (
            <span key={i} class={cls} data-kind={s.kind} data-index={i} style={{ ...pct(r[0], r[1]), ...size(r[2] - r[0] + 1, r[3] - r[1] + 1) }}>
              <StaticLampLight rect={r} fresh={isNew} />
            </span>
          );
        }
        return (
          <span key={i} class={cls} data-kind={s.kind} data-index={i} style={{ ...pct(s.x - HUNG_W / 2, s.y - HUNG_H / 2), ...size(HUNG_W, HUNG_H) }}>
            <HungLamp fresh={isNew} />
          </span>
        );
      })}
    </div>
  );
}

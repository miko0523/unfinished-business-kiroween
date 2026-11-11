import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { slotKey } from '../domain/slots';
import type { GhostKind, GhostState, SlotId, Task } from '../domain/types';
import { homeOnStage } from '../house/anchors';
import { GHOST_HEIGHT, GHOST_WIDTH } from '../house/ghostShape';
import { layoutHouse, type GrownFloors, type HouseLayout } from '../house/layout';
import { ghostPaint } from '../house/paint';
import { STAGE_WIDTH } from '../house/stage';
import { useAppContext } from '../store/StoreContext';
import { useStore } from '../store/useStore';
import { GhostButton } from './GhostButton';
import { GhostSprite } from './GhostSprite';
import { ResidentList } from './ResidentList';
import { useGhostPlays } from './useGhostPlays';
import { prefersReducedMotion, useReducedMotion } from './useReducedMotion';
import { useRoamer } from './useRoamer';
import { useStageGhost } from './useStageGhost';
import { useViewLayout } from './useViewLayout';

export interface ResidentLayerProps {
  /** 当前舞台显示的楼层数（用于把住客位换算成舞台坐标）。 */
  grownFloors: GrownFloors;
}

/** 正在搬走的住客：只剩样子，不再是控件。 */
interface Leaver {
  ghostKind?: GhostKind;
  slot: SlotId;
  state: GhostState;
  ratio: number;
  pending: boolean;
}

/** 两只同层住客的 Home Anchor 之间，一半的距离（舞台逻辑单位）。触控区在这条中线两侧各取一边，互不重叠。 */
export function hitHalfUnits(layout: HouseLayout, slot: SlotId): number {
  const a = homeOnStage(layout, { ...slot, slot: 0 });
  const b = homeOnStage(layout, { ...slot, slot: 1 });
  return a && b ? Math.abs(b.x - a.x) / 2 : 120;
}

/** 漫游中两只最近时中心约相距 120 个单位（打招呼位）；小到 120 单位不足 44 CSS px 时，漫游会让触控区叠起来。 */
const MIN_ROAM_PX = 44;
const GREET_GAP_UNITS = 120;

function boxStyle(layout: HouseLayout, home: { x: number; y: number }, hitHalf?: number) {
  // 锚点是身体底边中点：容器宽 140、高 180，底边中点落在 Home Anchor 上。
  return {
    ...(hitHalf === undefined ? {} : { '--hit-half-units': String(hitHalf) }),
    left: `${((home.x - GHOST_WIDTH / 2) / STAGE_WIDTH) * 100}%`,
    top: `${((home.y - GHOST_HEIGHT) / layout.stageHeight) * 100}%`,
    width: `${(GHOST_WIDTH / STAGE_WIDTH) * 100}%`,
    height: `${(GHOST_HEIGHT / layout.stageHeight) * 100}%`,
  };
}

/**
 * 动态层：每只 Ghost 是唯一的点击目标。楼层、墙面与空 Slot 不渲染任何可点击元素。
 * 位置用百分比定位（相对舞台），缩放时不需要 JS 重算；漫游由 useRoamer 接管。
 *
 * 一只离场（庆祝飞走、安静搬走）时，它的 Slot 在数据里立刻是空的，但在画面上还被它占着：
 * 这段时间里分到这个 Slot 的新住客先不露面（仍在列表里，只是看不见、也不可操作），等它走开后再入住。
 */
export function ResidentLayer({ grownFloors }: ResidentLayerProps) {
  const ctx = useAppContext();
  const { store, ui } = ctx;
  const tasks = useStore(store, (s) => s.tasks);
  const selectedId = useStore(ui, (s) => s.selectedTaskId);
  const holds = useStore(ui, (s) => s.holds);
  const [entering, setEntering] = useState<ReadonlySet<string>>(() => new Set());
  const [leaving, setLeaving] = useState<ReadonlyMap<string, Leaver>>(() => new Map());
  const layout = layoutHouse(grownFloors);
  const view = useViewLayout(grownFloors);
  const holdStill = view.scale * GREET_GAP_UNITS < MIN_ROAM_PX;
  // 系统打开“减少动态”时，还在入住途中的住客直接就位；之后关掉也不会再重演入住。
  const reducedNow = useReducedMotion();
  useEffect(() => {
    if (reducedNow) setEntering((prev) => (prev.size === 0 ? prev : new Set()));
  }, [reducedNow]);

  // 还被离场者占着的 Slot：其上的新住客等待露面。离场者本人（Task 已不在 tasks 里）留在调度器里直到走开。
  const waiting = useMemo(() => {
    const ids = new Set<string>();
    for (const task of tasks) {
      const holder = holds.get(slotKey(task.slot));
      if (holder !== undefined && holder !== task.id) ids.add(task.id);
    }
    return ids;
  }, [tasks, holds]);
  const visibleTasks = useMemo(() => tasks.filter((x) => !waiting.has(x.id)), [tasks, waiting]);
  const keep = useMemo<ReadonlySet<string>>(() => new Set(holds.values()), [holds]);

  const { register, poses, walks, runChore, pin, depart } = useRoamer(ctx, visibleTasks, selectedId, layout, keep, holdStill);
  const plays = useGhostPlays(store, runChore);
  // 被选中的 Ghost 本体飞到抽屉上沿的小舞台（同一个元素，屋里不留第二只）。须排在 useRoamer 之后。
  const lis = useRef(new Map<string, HTMLElement>());
  useStageGhost(ctx, selectedId, lis, useReducedMotion());
  const floorOf = (id: string) => tasks.find((x) => x.id === id)?.slot.floor ?? 2;
  const departRef = useRef(depart);
  departRef.current = depart;
  const pinRef = useRef(pin);
  pinRef.current = pin;

  useEffect(() => {
    const off = store.subscribeEvents((events) => {
      const ids = events.flatMap((e) => (e.type === 'GhostMovedIn' ? [e.taskId] : []));
      // 减少动态时没有入住动画，也就不会有“动画结束”可等。
      if (ids.length > 0 && !prefersReducedMotion()) setEntering((prev) => new Set([...prev, ...ids]));
      for (const e of events) {
        // 确认完成：它马上要在庆祝层里演出，先停在当下的位置（Slot 的占用由庆祝层登记与归还）。
        if (e.type === 'Confirmed') pinRef.current(e.taskId);
        if (e.type !== 'MovedOutQuietly' || prefersReducedMotion()) continue;
        // 减少动态：直接移除（Task 已不在 tasks 里，下一次渲染它就消失，文字播报由 live 区负责）；
        // 否则登记占用并开始搬走。
        const key = slotKey(e.slot);
        ui.holdSlot(key, e.taskId);
        setLeaving((prev) => new Map(prev).set(e.taskId, { ghostKind: e.ghostKind, slot: e.slot, state: e.state, ratio: e.ratio, pending: e.pending }));
        departRef.current(e.taskId, () => {
          setLeaving((prev) => {
            if (!prev.has(e.taskId)) return prev;
            const next = new Map(prev);
            next.delete(e.taskId);
            return next;
          });
          if (ui.getState().holds.get(key) === e.taskId) ui.releaseSlot(key);
        });
      }
    });
    return () => {
      off();
      // 整层卸下（例如进入示例）：不要把占用留在真实界面的状态里。
      ui.releaseAllSlots();
    };
  }, [store, ui]);

  if (tasks.length === 0 && leaving.size === 0) return null;

  const finishEntering = (id: string) =>
    setEntering((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  const renderResident = (task: Task) => {
    const home = homeOnStage(layout, task.slot);
    if (!home) return null;
    const isWaiting = waiting.has(task.id);
    return (
      <li
        key={task.id}
        class="resident"
        data-waiting={isWaiting ? 'true' : undefined}
        style={boxStyle(layout, home, hitHalfUnits(layout, task.slot))}
        ref={(el) => {
          register(task.id, el);
          if (el) lis.current.set(task.id, el);
          else lis.current.delete(task.id);
        }}
      >
        <GhostButton
          task={task}
          selected={selectedId === task.id}
          entering={entering.has(task.id) && !isWaiting}
          play={plays.get(task.id)}
          pose={poses.get(task.id) ?? 'rest'}
          walk={walks.get(task.id) ?? 0}
          onSelect={(id, trigger) => ui.activateGhost(id, floorOf(id), trigger)}
          onEntered={finishEntering}
        />
      </li>
    );
  };

  return (
    <>
      <ResidentList tasks={tasks} renderResident={renderResident} />
      {leaving.size > 0 ? (
        <div class="residents-leaving" aria-hidden="true">
          {[...leaving].map(([id, who]) => {
            const home = homeOnStage(layout, who.slot);
            if (!home) return null;
            const pose = poses.get(id) ?? 'rest';
            return (
              <div key={id} class="resident is-leaving" style={boxStyle(layout, home)} ref={(el) => register(id, el)}>
                <span class="ghost-motion">
                  <GhostSprite ghostKind={who.ghostKind} paint={ghostPaint(who.state, who.ratio, who.pending)} expression="shy" prop={pose === 'tool' ? 'suitcase' : 'none'} />
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </>
  );
}

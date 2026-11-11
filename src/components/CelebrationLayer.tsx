import { stampFor } from '../domain/collection';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { flightArc } from '../animation/flight';
import { FLY_MS, planCelebration, type PlanStep } from '../animation/plan';
import { slotKey } from '../domain/slots';
import type { MemorialEntry, SlotId } from '../domain/types';
import { homeOnStage } from '../house/anchors';
import { LOBBY } from '../house/data/lobby';
import type { Point } from '../house/data/slots';
import { GHOST_HEIGHT, GHOST_WIDTH } from '../house/ghostShape';
import { layoutHouse, type GrownFloors } from '../house/layout';
import { ghostPaint } from '../house/paint';
import { STAGE_WIDTH, stageBoxes } from '../house/stage';
import { useCopy } from './useCopy';
import { useAppContext } from '../store/StoreContext';
import { useStore } from '../store/useStore';
import { WIDE_MIN } from '../house/viewport';
import { BurstFx } from './GhostFx';
import { GhostSprite } from './GhostSprite';
import { FlyStar, STAR_CENTER, TRAIL_COUNT } from './FlyStar';
import { StampCard } from './StampCard';
import { floorModuleForFloor } from '../house/assets';
import { FLOOR_SPACES } from '../house/data/space';
import { prefersReducedMotion, useReducedMotion } from './useReducedMotion';
import { settleFocus } from './focusFallback';

export interface CelebrationLayerProps {
  grownFloors: GrownFloors;
}

interface Run {
  entry: MemorialEntry;
  from: Point;
  /** 起飞点在视口里的位置（Ghost 站在抽屉上沿的小舞台上时才有）：镜头变化后据此重新换算 from。 */
  vp: Point | null;
  floor: SlotId['floor'];
  phase: PlanStep['kind'];
  /** Reduced_Motion：不播放位移，只静止展示盖章页。 */
  still: boolean;
}

/**
 * 站在抽屉上沿小舞台上的 Ghost 常常在旧宅舞台的上方或下方（舞台缩得很小、抽屉又高的时候尤其如此）。
 * 它的盖章卡不该被夹在旧宅的墙面里，所以竖直方向不设界，只由视口来夹（StampCard 里已经做了）。
 */
const OFF_STAGE = 100_000;
const STILL_MS = 2400;
/** 飞行开始后过这么久，新住客才可以在刚腾出的 Slot 里露面。 */
const SLOT_FREE_AFTER_FLY_MS = 500;

/** 这一层墙面内部（可导航区）在舞台逻辑像素里的矩形；找不到这一层时退回整个舞台。 */
function interiorOf(layout: ReturnType<typeof layoutHouse>, floor: SlotId['floor']): [number, number, number, number] {
  const id = floorModuleForFloor(floor);
  const box = stageBoxes(layout).find((b) => b.id === id);
  const nav = FLOOR_SPACES[id].navigable;
  if (!box) return [0, 0, STAGE_WIDTH, layout.stageHeight];
  return [box.x + nav[0], box.y + nav[1], box.x + nav[2], box.y + nav[3]];
}

/**
 * 庆祝层：确认写入成功之后，依次变金、挥手、盖章、飞进纪念册（共 4.6 秒），可随时跳过。
 * 数据在序列开始前就已经是最终状态（纪念册里有 Entry、Slot 已腾空）；这里只负责演出，
 * 所以跳过、刷新或打断都不会影响数据。盖章页只显示 Stamp 与留言，不显示标题。
 */
export function CelebrationLayer({ grownFloors }: CelebrationLayerProps) {
  const t = useCopy();
  const { store, ui, roam } = useAppContext();
  const [run, setRun] = useState<Run | null>(null);
  const timers = useRef<unknown[]>([]);
  const flyer = useRef<HTMLDivElement>(null);
  const anims = useRef<Animation[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const layoutRef = useRef(layoutHouse(grownFloors));
  layoutRef.current = layoutHouse(grownFloors);
  /** 庆祝期间被这只 Ghost 占着的 Slot；归还之后新住客才会在那里露面。 */
  const held = useRef<string | null>(null);
  /** 手机：确认后镜头自动进入全景，庆祝结束后回到进入前的镜头。 */
  const cameraBefore = useRef<'focus' | 'panorama' | null>(null);
  const camera = useStore(ui, (s) => s.camera);
  const reduced = useReducedMotion();

  const releaseSlot = () => {
    if (held.current === null) return;
    ui.releaseSlot(held.current);
    held.current = null;
  };
  const clearAll = () => {
    for (const h of timers.current) clearTimeout(h as number);
    timers.current = [];
    for (const a of anims.current) a.cancel();
    anims.current = [];
    releaseSlot();
  };
  const finish = () => {
    // 焦点若正停在“跳过动画”上，它随庆祝一起消失：提交之后把焦点交给创建框或页面标题。
    const hadFocus = !!root.current && root.current.contains(document.activeElement);
    clearAll();
    if (cameraBefore.current) ui.setCamera(cameraBefore.current);
    cameraBefore.current = null;
    setRun(null);
    ui.setCelebration(null);
    if (hadFocus) settleFocus();
  };

  useEffect(() => {
    const off = store.subscribeEvents((events) => {
      for (const e of events) {
        if (e.type !== 'Confirmed') continue;
        const entry = store.getState().archive.find((x) => x.id === e.entryId);
        if (!entry) continue;
        clearAll();
        const slot: SlotId = e.slot;
        // 变金、挥手、盖章阶段它静止在原地，飞行开始后约 0.5 秒才归还 Slot（跳过则立刻归还）。
        held.current = slotKey(slot);
        ui.holdSlot(held.current, e.taskId);
        // 站在抽屉上沿小舞台上的 Ghost：从它此刻实际的位置演出与起飞；否则从它在屋里的位置。
        const onStage = roam.stagePointOf?.(e.taskId) ?? null;
        const at = onStage ? onStage.logical : roam.positionOf(e.taskId);
        const vp: Point | null = onStage ? onStage.viewport : null;
        if (window.innerWidth < WIDE_MIN) {
          cameraBefore.current = ui.getState().camera;
          ui.setCamera('panorama');
        }
        const home = homeOnStage(layoutRef.current, slot);
        const from: Point | null = at ?? (home ? [home.x, home.y] : null);
        if (!from) {
          releaseSlot();
          ui.setCelebration(null);
          continue;
        }
        if (prefersReducedMotion()) {
          setRun({ entry, from, vp, floor: slot.floor, phase: 'stamp', still: true });
          ui.setCelebration({ entryId: entry.id, phase: 'stamp', lampOn: true });
          timers.current.push(setTimeout(finish, STILL_MS));
          continue;
        }
        const plan = planCelebration({ archiveDerived: LOBBY.archiveBook.status === 'derived' });
        let at0 = 0;
        let flyStart: number = plan.totalMs;
        for (const step of plan.steps) {
          const start = at0;
          if (step.kind === 'fly') flyStart = start;
          const begin = () => {
            setRun((prev) => ({ entry, from: prev?.from ?? from, vp, floor: slot.floor, phase: step.kind, still: false }));
            ui.setCelebration({ entryId: entry.id, phase: step.kind, lampOn: start >= plan.lampAtMs });
          };
          // 第一步立刻开始：暖灯据此知道要等飞行的最后 0.5 秒才亮，不会在确认的那一刻先闪一下。
          if (start === 0) begin();
          else timers.current.push(setTimeout(begin, start));
          at0 += step.ms;
        }
        if (plan.steps.some((s) => s.kind === 'fly')) {
          timers.current.push(setTimeout(() => ui.setCelebration({ entryId: entry.id, phase: 'fly', lampOn: true }), plan.lampAtMs));
        }
        timers.current.push(setTimeout(releaseSlot, Math.min(plan.totalMs, flyStart + SLOT_FREE_AFTER_FLY_MS)));
        timers.current.push(setTimeout(finish, plan.totalMs));
      }
    });
    return () => {
      off();
      clearAll();
    };
  }, [store]);

  // 庆祝进行中，系统打开了“减少动态”：立刻取消还在飞的动画和计时，改为静止的盖章页（与一开始就是减少动态时相同）。
  useEffect(() => {
    if (!reduced || !run || run.still) return;
    for (const h of timers.current) clearTimeout(h as number);
    timers.current = [];
    for (const a of anims.current) a.cancel();
    anims.current = [];
    setRun({ ...run, phase: 'stamp', still: true });
    ui.setCelebration({ entryId: run.entry.id, phase: 'stamp', lampOn: true });
    timers.current.push(setTimeout(finish, STILL_MS));
  }, [reduced]);

  // 镜头变了（手机确认后进入全景，房子缩小）：Ghost 仍留在屏幕上的原处，按新的舞台尺寸重新换算它的位置。
  useLayoutEffect(() => {
    if (!run?.vp) return;
    const rect = root.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const k = rect.width / STAGE_WIDTH;
    const from: Point = [(run.vp[0] - rect.left) / k, (run.vp[1] - rect.top) / k];
    if (Math.abs(from[0] - run.from[0]) < 0.5 && Math.abs(from[1] - run.from[1]) < 0.5) return;
    setRun({ ...run, from });
  }, [camera, run?.vp, run?.phase]);

  // 飞行：盖完章，小幽灵化成一颗星星，沿弧线飞进门厅桌上的大书；身后跟几颗渐淡的小星做拖尾。
  useEffect(() => {
    if (!run || run.phase !== 'fly' || run.still) return;
    const el = flyer.current;
    const book = LOBBY.archiveBook;
    const lobby = stageBoxes(layoutRef.current).find((b) => b.id === 'lobby');
    if (!el || book.status !== 'derived' || !lobby || typeof el.animate !== 'function') return;
    const dx = lobby.x + book.x - run.from[0];
    const dy = lobby.y + book.y - (run.from[1] - GHOST_HEIGHT + STAR_CENTER[1]);
    const pts = flightArc(dx, dy, 70);
    const frames = pts.map((p, i) => ({
      transform: `translate(${(p.x / GHOST_WIDTH) * 100}%, ${(p.y / GHOST_HEIGHT) * 100}%) scale(${p.scale})`,
      opacity: i === pts.length - 1 ? 0.2 : 1,
      offset: p.offset,
    }));
    const trails = root.current ? [...root.current.querySelectorAll<HTMLElement>('.celebration-trail')] : [];
    try {
      const play = (target: HTMLElement, delay: number, fade: number) => {
        const a = target.animate(
          frames.map((f) => ({ ...f, opacity: Math.min(f.opacity, fade) })),
          { duration: FLY_MS, delay, easing: 'ease-in-out', fill: 'both' },
        );
        a.finished?.catch(() => {}); // 取消（跳过）时 finished 会被拒绝，这是正常的
        anims.current.push(a);
      };
      play(el, 0, 1);
      trails.forEach((tr, i) => play(tr, 90 * (i + 1), 0.7 - i * 0.14));
    } catch {
      /* 动画不可用：稳态由数据决定 */
    }
  }, [run?.phase, run?.still]);

  if (!run) return null;
  const layout = layoutRef.current;
  const { entry, from, phase } = run;
  const box = {
    left: `${((from[0] - GHOST_WIDTH / 2) / STAGE_WIDTH) * 100}%`,
    top: `${((from[1] - GHOST_HEIGHT) / layout.stageHeight) * 100}%`,
    width: `${(GHOST_WIDTH / STAGE_WIDTH) * 100}%`,
    height: `${(GHOST_HEIGHT / layout.stageHeight) * 100}%`,
  };
  const showStamp = phase === 'stamp';

  const stage = phase === 'stamp' ? 'stamp' : phase === 'wave' ? 'wave' : phase === 'gold' ? 'gold' : 'fly';
  return (
    <div ref={root} class="celebration" data-phase={phase} data-still={run.still ? 'true' : 'false'}>
      {phase === 'fly' && !run.still
        ? Array.from({ length: TRAIL_COUNT }, (_, i) => (
            <div key={i} class="celebration-trail" style={box}>
              <FlyStar trail={i} />
            </div>
          ))
        : null}
      <div ref={flyer} class={`celebration-ghost is-${stage}${phase === 'gold' ? ' is-gold' : ''}${phase === 'wave' ? ' is-waving' : ''}${phase === 'stamp' ? ' is-stamping' : ''}`} style={box}>
        <GhostSprite
          key={phase === 'fly' ? 'fly' : 'stay'}
          paint={ghostPaint('gold', 1, false)}
          ghostKind={entry.ghostKind}
          expression={phase === 'stamp' ? 'focused' : 'happy'}
        >
          {phase === 'gold' && !run.still ? <BurstFx burst={{ kind: 'full', n: 1 }} /> : null}
        </GhostSprite>
        {phase === 'fly' && !run.still ? <FlyStar /> : null}
      </div>
      {showStamp ? (
        <StampCard kind={stampFor(store.getState().archive.findIndex((x) => x.id === entry.id))} entry={entry} anchor={from} interior={run.vp ? [0, -OFF_STAGE, STAGE_WIDTH, layout.stageHeight + OFF_STAGE] : interiorOf(layout, run.floor)} />
      ) : null}
      <button type="button" class="skip-animation" onClick={finish}>
        {t('celebrate.skip')}
      </button>
    </div>
  );
}

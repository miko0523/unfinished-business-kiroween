// 仅开发模式存在的校准层：把所有位置画在同一个画面里核对。入口见 main.tsx（#/calibrate，受 import.meta.env.DEV 门控）。
import './calibrate.css';
import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { House } from '../../components/House';
import { srcFor, floorModuleForFloor } from '../../house/assets';
import { LOBBY, LAMP_SLOT_COUNT, type LobbyAnchors } from '../../house/data/lobby';
import { FLOOR_SLOTS, type Rect } from '../../house/data/slots';
import { layoutHouse, type GrownFloors } from '../../house/layout';
import { percentBox, stageBoxes, type StageBox } from '../../house/stage';
import { findGlowRegions, type GlowRegion } from './glow';

function Item({
  kind,
  box,
  stageHeight,
  class: cls,
  label,
  attrs,
}: {
  kind: string;
  box: { x: number; y: number; w: number; h: number };
  stageHeight: number;
  class: string;
  label?: string;
  attrs?: Record<string, string | number>;
}) {
  return (
    <div class={`cal-item ${cls}`} data-debug={kind} style={percentBox(box.x, box.y, box.w, box.h, stageHeight)} {...attrs}>
      {label ? <span class="cal-label">{label}</span> : null}
    </div>
  );
}

function rectBox(base: StageBox, r: Rect) {
  // room-layout.json 的矩形含边界：[xmin,ymin,xmax,ymax]
  return { x: base.x + r[0], y: base.y + r[1], w: r[2] - r[0] + 1, h: r[3] - r[1] + 1 };
}

function Missing({ item, text, row, base, stageHeight }: { item: string; text: string; row: number; base: StageBox; stageHeight: number }) {
  const top = percentBox(0, base.y + 8 + row * 22, 0, 0, stageHeight).top;
  return (
    <div class="cal-item cal-missing" data-debug="missing" data-item={item} style={{ top }}>
      {text}
    </div>
  );
}

export function LobbyOverlay({ base, stageHeight, lobby }: { base: StageBox; stageHeight: number; lobby: LobbyAnchors }) {
  const items: ComponentChildren[] = [];
  const book = lobby.archiveBook;
  if (book.status === 'derived') {
    items.push(
      <Item kind="archive-hit" box={rectBox(base, book.hit)} stageHeight={stageHeight} class="cal-dashed" label="纪念册热区" />,
      <div
        class="cal-cross"
        data-debug="archive-point"
        style={{ left: percentBox(base.x + book.x, 0, 0, 0, stageHeight).left, top: percentBox(0, base.y + book.y, 0, 0, stageHeight).top }}
      />,
    );
  } else {
    items.push(<Missing item="archiveBook" text="纪念册目标点：未派生" row={0} base={base} stageHeight={stageHeight} />);
  }
  const lamps = lobby.staticLampRects;
  if (lamps.status === 'derived') {
    lamps.rects.forEach((r, i) => {
      items.push(<Item kind="static-lamp-rect" box={rectBox(base, r)} stageHeight={stageHeight} class="cal-dashed" label={`静态灯 ${i + 1}`} />);
    });
  } else {
    items.push(<Missing item="staticLampRects" text="静态灯占位：未派生" row={1} base={base} stageHeight={stageHeight} />);
  }
  const slots = lobby.lampSlots;
  if (slots.status === 'derived') {
    slots.slots.forEach((s, i) => {
      items.push(
        <div
          class="cal-item cal-lamp"
          data-debug="lamp-slot"
          data-n={i + 1}
          style={{ left: percentBox(base.x + s.x, 0, 0, 0, stageHeight).left, top: percentBox(0, base.y + s.y, 0, 0, stageHeight).top }}
        >
          {i + 1}
        </div>,
      );
    });
  } else {
    items.push(<Missing item="lampSlots" text={`暖灯候选位（${LAMP_SLOT_COUNT} 个）：未派生`} row={2} base={base} stageHeight={stageHeight} />);
  }
  return <>{items}</>;
}

/** 在实际 lobby.png 上量亮区。只作证据层，绝不写入 LOBBY。 */
function useGlowRegions(): GlowRegion[] | null {
  const [regions, setRegions] = useState<GlowRegion[] | null>(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      setRegions(findGlowRegions(ctx.getImageData(0, 0, canvas.width, canvas.height)));
    };
    img.src = srcFor('lobby');
  }, []);
  return regions;
}

export function Calibrate({ lobby = LOBBY }: { lobby?: LobbyAnchors }) {
  const [grownFloors, setGrownFloors] = useState<GrownFloors>(6);
  const glow = useGlowRegions();
  const layout = layoutHouse(grownFloors);
  const boxes = stageBoxes(layout);
  const sh = layout.stageHeight;
  const lobbyBox = boxes[0]!;

  return (
    <main class="night-sky" data-debug="calibrate-root">
      <div class="cal-bar" data-debug="floor-switch">
        <span>楼层数</span>
        {([2, 3, 4, 5, 6] as const).map((n) => (
          <button key={n} type="button" aria-pressed={grownFloors === n} data-n={n} onClick={() => setGrownFloors(n)}>
            {n}
          </button>
        ))}
      </div>
      <House grownFloors={grownFloors}>
        <Item kind="lobby-box" box={lobbyBox} stageHeight={sh} class="cal-floor-box" label="门厅 1F" />
        <LobbyOverlay base={lobbyBox} stageHeight={sh} lobby={lobby} />
        {glow?.map((g, i) => (
          <Item
            kind="glow-evidence"
            box={rectBox(lobbyBox, [g.x0, g.y0, g.x1, g.y1])}
            stageHeight={sh}
            class="cal-glow"
            label={`实测亮区 ${i + 1}（非灯位数据）`}
            attrs={{ 'data-x0': g.x0, 'data-y0': g.y0, 'data-x1': g.x1, 'data-y1': g.y1 }}
          />
        ))}
        {boxes.slice(1).map((b) => {
          if (b.id === 'roof') return <Item kind="roof-box" box={b} stageHeight={sh} class="cal-floor-box" label="屋顶" />;
          const floor = Number(b.id.slice(-2)) + 1;
          const slots = FLOOR_SLOTS[floorModuleForFloor(floor)];
          return (
            <>
              <Item kind="floor-box" box={b} stageHeight={sh} class="cal-floor-box" label={`${floor}F`} attrs={{ 'data-floor': floor }} />
              {(['left', 'right'] as const).map((side) => {
                const tag = side === 'left' ? 'L' : 'R';
                const s = slots[side];
                return (
                  <>
                    <Item
                      kind="safe-rect"
                      box={rectBox(b, s.safe)}
                      stageHeight={sh}
                      class="cal-safe"
                      label={`${floor}${tag}`}
                      attrs={{ 'data-floor': floor, 'data-side': tag }}
                    />
                    <div
                      class="cal-cross"
                      data-debug="idle-point"
                      data-floor={floor}
                      data-side={tag}
                      style={{ left: percentBox(b.x + s.idle[0], 0, 0, 0, sh).left, top: percentBox(0, b.y + s.idle[1], 0, 0, sh).top }}
                    />
                  </>
                );
              })}
            </>
          );
        })}
      </House>
    </main>
  );
}

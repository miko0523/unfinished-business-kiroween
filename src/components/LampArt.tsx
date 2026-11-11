import { lanternSrc, LANTERN_ASPECT } from '../house/assets';
import type { Rect } from '../house/data/slots';
import { STAR_PATH } from './GhostFx';

// 门厅暖灯的画法。灯光是暖金色（与金色 Ghost 的光晕同色系），慢呼吸、不闪；火苗只做极轻的摇曳。
// 前 3 盏：叠在门厅原画里已有的三盏小灯笼上（原画不动，只加暖光、玻璃里的暖色与火苗）。
// 后 9 盏：挂在墙上的灯笼组件（透明 PNG）+ 代码画的小挂钩与细绳 + 同样的暖光。

export const GLOW = '#FFD479';
export const FLAME_OUTER = '#FFE08A';
export const FLAME_INNER = '#FFF6C9';

/** 亮起那一下冒出的一两颗小星（对辅助技术隐藏；减少动态下不显示）。 */
export function LampSparks({ width, height }: { width: number; height: number }) {
  return (
    <svg class="lamp-sparks" viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
      <g transform={`translate(${width * 0.28} ${height * 0.12})`}>
        <path class="fx-star" d={STAR_PATH} transform="scale(3.4)" style="--dx:-6px;--dy:-12px;animation-duration:1.2s" />
      </g>
      <g transform={`translate(${width * 0.74} ${height * 0.2})`}>
        <path class="fx-star" d={STAR_PATH} transform="scale(2.6)" style="--dx:7px;--dy:-10px;animation-duration:1.1s;animation-delay:0.15s" />
      </g>
    </svg>
  );
}

/** 原画里的灯笼：rect 是静态灯框（含外扩 4），玻璃约在内缩 4 的范围里。 */
export function StaticLampLight({ rect, fresh }: { rect: Rect; fresh: boolean }) {
  const w = rect[2] - rect[0] + 1;
  const h = rect[3] - rect[1] + 1;
  const gx = 4;
  const gy = 4;
  const gw = w - 8;
  const gh = h - 8;
  const cx = w / 2;
  const cy = h / 2 + 1;
  const fh = Math.max(8, gh * 0.5);
  const fw = fh * 0.5;
  return (
    <>
      <span class="lamp-halo" style={{ width: '240%', height: '240%' }} />
      <svg class="lamp-art" viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false">
        <rect x={gx} y={gy} width={gw} height={gh} rx="5" fill={GLOW} opacity="0.4" class="lamp-tint" />
        <g class="lamp-flame" style={`transform-origin:${cx}px ${cy + fh / 2}px`}>
          <path d={`M${cx} ${cy - fh / 2} C${cx + fw} ${cy - fh * 0.1} ${cx + fw * 0.8} ${cy + fh * 0.4} ${cx} ${cy + fh / 2} C${cx - fw * 0.8} ${cy + fh * 0.4} ${cx - fw} ${cy - fh * 0.1} ${cx} ${cy - fh / 2} Z`} fill={FLAME_OUTER} />
          <path d={`M${cx} ${cy - fh * 0.15} C${cx + fw * 0.45} ${cy + fh * 0.1} ${cx + fw * 0.35} ${cy + fh * 0.35} ${cx} ${cy + fh * 0.42} C${cx - fw * 0.35} ${cy + fh * 0.35} ${cx - fw * 0.45} ${cy + fh * 0.1} ${cx} ${cy - fh * 0.15} Z`} fill={FLAME_INNER} />
        </g>
      </svg>
      {fresh ? <LampSparks width={w} height={h} /> : null}
    </>
  );
}

/** 挂在墙上的灯笼组件：宽 27、高 46（占位），顶边是挂钩。 */
export const HUNG_W = 27;
export const HUNG_H = 46;
const IMG_TOP = 8;
const IMG_H = 37;
const IMG_W = IMG_H * LANTERN_ASPECT;

export function HungLamp({ fresh }: { fresh: boolean }) {
  const left = (HUNG_W - IMG_W) / 2;
  // All artwork uses the slot's coordinate system, including at narrow widths.
  const artBox = { left: `${left / HUNG_W * 100}%`, top: `${IMG_TOP / HUNG_H * 100}%`, width: `${IMG_W / HUNG_W * 100}%`, height: `${IMG_H / HUNG_H * 100}%` };
  return (
    <>
      <span class="lamp-halo" style={{ width: `${78 / HUNG_W * 100}%`, height: `${78 / HUNG_H * 100}%`, top: `${(IMG_TOP + IMG_H * 0.68) / HUNG_H * 100}%` }} />
      <svg class="lamp-hook" viewBox={`0 0 ${HUNG_W} ${HUNG_H}`} aria-hidden="true" focusable="false">
        <path d={`M${HUNG_W / 2} 3 L${HUNG_W / 2} ${IMG_TOP + 2}`} stroke="#4a3320" stroke-width="1" fill="none" />
        <circle cx={HUNG_W / 2} cy="3" r="2.1" fill="#8b6b43" stroke="#2b1c10" stroke-width="0.8" />
      </svg>
      <img class="lamp-lantern" src={lanternSrc()} alt="" width={IMG_W} height={IMG_H} style={artBox} draggable={false} />
      <svg class="lamp-art" viewBox="0 0 1024 1536" aria-hidden="true" focusable="false" style={artBox}>
        <rect x="262" y="742" width="506" height="490" rx="22" fill={GLOW} opacity="0.42" class="lamp-tint" />
        <g class="lamp-flame" style="transform-origin:505px 1272px">
          <path d="M505 790 C566 892 612 990 602 1104 C597 1196 548 1262 505 1274 C462 1262 413 1196 408 1104 C398 990 444 892 505 790 Z" fill={FLAME_OUTER} />
          <path d="M505 960 C545 1030 565 1100 552 1170 C545 1215 522 1240 505 1246 C488 1240 465 1215 458 1170 C445 1100 465 1030 505 960 Z" fill={FLAME_INNER} />
        </g>
      </svg>
      {fresh ? <LampSparks width={HUNG_W} height={HUNG_H} /> : null}
    </>
  );
}

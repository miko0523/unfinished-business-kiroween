import type { StampKind } from '../domain/collection';
import { STAMP_PATHS } from '../house/stampShapes';

export function SealMark({ kind = 'envelope', locked = false }: { kind?: StampKind; locked?: boolean }) {
  const ink = locked ? '#9A9488' : '#AE781F';
  return (
    <svg class="stamp-seal" viewBox="0 0 100 100" data-stamp={kind} aria-hidden="true" focusable="false">
      <circle cx="50" cy="50" r="46" fill={locked ? '#E5DFD2' : '#FFF7DF'} stroke={locked ? '#AAA396' : '#C9952F'} stroke-width="3" stroke-dasharray={locked ? '5 4' : undefined} />
      {!locked ? <circle cx="50" cy="50" r="40" fill="none" stroke="#C9952F" stroke-width="1" /> : null}
      <path class="stamp-object" d={STAMP_PATHS[kind]} stroke={ink} stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" fill={locked ? ink : 'none'} opacity={locked ? .3 : 1} />
      {locked ? <text x="50" y="64" text-anchor="middle" fill="#716A60" font-size="40" font-family="Georgia, serif">?</text> : null}
    </svg>
  );
}

import { useId } from 'preact/hooks';
import { collectedCount } from '../domain/collection';
import { ghostPaint } from '../house/paint';
import { PORTRAIT, revealRank } from '../house/reveal';
import { GhostSprite } from './GhostSprite';
import { useCopy } from './useCopy';

/** The folded-over bottom-right corner of the pasted sticker, with its own soft shadow. */
function StickerCurl() {
  const uid = useId();
  return (
    <svg class="sticker-curl" viewBox="0 0 30 30" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${uid}-paper`} x1="1" y1="1" x2="0" y2="0">
          <stop offset="0" stop-color="#BFAA78" />
          <stop offset=".45" stop-color="#EFE2BC" />
          <stop offset="1" stop-color="#FFF9E6" />
        </linearGradient>
        <filter id={`${uid}-soft`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.5" />
        </filter>
      </defs>
      <path d="M31.5 6 L6 31.5 L6 6 Z" fill="#2A1A08" opacity=".38" filter={`url(#${uid}-soft)`} />
      <path d="M30 4 L4 30 L4 4 Z" fill={`url(#${uid}-paper)`} />
      <path d="M30 4 L4 30" stroke="#8C7647" stroke-width=".6" opacity=".55" fill="none" />
    </svg>
  );
}

/**
 * One shared painting, with opaque tiles laid over its actual coordinates. It is presented as a slightly tilted sticker
 * pasted across both book pages: opaque paper that hides the gutter, a soft paper shadow and a curled corner.
 */
export function RevealPage({ completed }: { completed: number }) {
  const t = useCopy();
  const count = collectedCount(completed);
  return (
    <section class="reveal-page" aria-labelledby="reveal-title">
      <h3 id="reveal-title" tabIndex={-1}>{t('collection.reveal')}</h3>
      <p>{t(count === 12 ? 'collection.revealed' : 'collection.mist')}</p>
      <div class="sticker-bed">
      <div class="sticker-wrap">
      <div class="reveal-sticker">
      <svg class="reveal-picture" viewBox="0 0 400 300" role="img" aria-label={t('collection.picture', { count, total: 12 })}>
        <rect width="400" height="300" fill="#2E3B5C" />
        <g fill="#F9E4A7" opacity=".65" aria-hidden="true">
          <circle cx="37" cy="40" r="2" /><circle cx="353" cy="68" r="2" />
          <circle cx="65" cy="239" r="1.5" /><circle cx="330" cy="251" r="1.5" />
        </g>
        <svg class="reveal-portrait" {...PORTRAIT} viewBox="0 0 140 180" aria-hidden="true">
          <GhostSprite paint={ghostPaint('gold', 1, false)} ghostKind="lantern" />
        </svg>
        {Array.from({ length: 12 }, (_, cell) => {
          const rank = revealRank(cell);
          const x = (cell % 4) * 100;
          const y = Math.floor(cell / 4) * 100;
          return (
            <g class="mist-tile" data-cell={cell} data-rank={rank} data-latest={rank === completed ? 'true' : undefined} data-open={rank <= count ? 'true' : 'false'} aria-hidden="true" key={cell}>
              <rect x={x} y={y} width="100" height="100" fill="#D9D4C9" />
              <path d={`M${x} ${y + 100} V${y} H${x + 100}`} fill="none" stroke="#B6B0A3" stroke-width="1" />
              <text x={x + 50} y={y + 62} text-anchor="middle" font-family="Georgia, serif" font-size="32" fill="#7A756C">?</text>
            </g>
          );
        })}
      </svg>
      </div>
      <StickerCurl />
      </div>
      </div>
      <p class="collection-reward">{t(count === 12 ? 'collection.promise' : 'collection.hint')}</p>
    </section>
  );
}

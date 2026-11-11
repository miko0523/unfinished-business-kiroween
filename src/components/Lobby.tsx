import { LOBBY } from '../house/data/lobby';
import { layoutHouse, type GrownFloors } from '../house/layout';
import { STAGE_WIDTH, stageBoxes } from '../house/stage';
import { useCopy } from './useCopy';
import { useAppContext } from '../store/StoreContext';
import { useStore } from '../store/useStore';

export interface LobbyProps {
  grownFloors: GrownFloors;
}

/** 门厅里唯一可点的地方：摊开的大书（纪念册入口）。热区至少 44×44 CSS px，以书的中心为准。 */
export function Lobby({ grownFloors }: LobbyProps) {
  const t = useCopy();
  const { ui } = useAppContext();
  // 告别的星星飞到书上的最后 0.5 秒，书页亮一下。
  const glowing = useStore(ui, (s) => s.celebration?.phase === 'fly' && s.celebration.lampOn);
  const book = LOBBY.archiveBook;
  if (book.status !== 'derived') return null;
  const layout = layoutHouse(grownFloors);
  const lobby = stageBoxes(layout).find((b) => b.id === 'lobby');
  if (!lobby) return null;
  const [x0, y0, x1, y1] = book.hit;
  const style = {
    left: `${((lobby.x + (x0 + x1) / 2) / STAGE_WIDTH) * 100}%`,
    top: `${((lobby.y + (y0 + y1) / 2) / layout.stageHeight) * 100}%`,
    width: `${((x1 - x0) / STAGE_WIDTH) * 100}%`,
    height: `${((y1 - y0) / layout.stageHeight) * 100}%`,
  };
  return (
    <button
      type="button"
      class="archive-book"
      style={style}
      data-glow={glowing ? 'true' : undefined}
      aria-label={t('lobby.archive')}
      onClick={() => {
        window.location.hash = '#/archive';
      }}
    />
  );
}

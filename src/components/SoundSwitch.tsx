import { useStore } from '../store/useStore';
import { useCopy } from './useCopy';
import { useSoundController } from './useSound';

/** 右上角的小喇叭：按下 = 开。正常、示例、恢复与内存模式共用；开关不记住，每次加载都是关。 */
export function SoundSwitch() {
  const t = useCopy();
  const sound = useSoundController();
  const status = useStore(sound, (s) => s.status);
  const on = status !== 'off';
  return (
    <button
      type="button"
      class="sound-switch"
      data-sound-switch=""
      data-sound-state={status}
      aria-pressed={on}
      aria-label={t('sound.label')}
      onClick={() => sound.toggle()}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
        <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
        {on ? (
          <g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <path d="M15.2 9.2a4 4 0 0 1 0 5.6" />
            <path d="M17.8 6.8a7.4 7.4 0 0 1 0 10.4" />
          </g>
        ) : (
          <g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <path d="M15.5 9.5l5 5" />
            <path d="M20.5 9.5l-5 5" />
          </g>
        )}
      </svg>
    </button>
  );
}
